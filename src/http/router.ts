import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NotFoundError, ValidationError } from '../domain/types.js';
import type { LinkService } from '../service.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new ValidationError('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('body must be valid JSON');
  }
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  const rel = normalize(pathname === '/' ? 'index.html' : pathname.slice(1));
  if (rel.startsWith('..')) return false;
  try {
    const body = await readFile(join(PUBLIC_DIR, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/** Returns a request handler bound to the given service. */
export function createRouter(service: LinkService) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname, searchParams } = url;
    const method = req.method ?? 'GET';

    try {
      if (pathname === '/api/health') {
        return send(res, 200, { ok: true });
      }

      if (pathname === '/api/links' && method === 'GET') {
        const text = searchParams.get('q');
        const tag = searchParams.get('tag');
        return send(res, 200, {
          links: await service.list({
            ...(text !== null ? { text } : {}),
            ...(tag !== null ? { tag } : {}),
            unreadOnly: searchParams.get('unread') === 'true',
          }),
        });
      }

      if (pathname === '/api/links' && method === 'POST') {
        const link = await service.add((await readJson(req)) as never);
        return send(res, 201, { link });
      }

      if (pathname === '/api/tags' && method === 'GET') {
        return send(res, 200, { tags: await service.tags() });
      }

      const linkId = /^\/api\/links\/([\w-]+)$/.exec(pathname)?.[1];
      if (linkId !== undefined) {
        if (method === 'GET') return send(res, 200, { link: await service.get(linkId) });
        if (method === 'DELETE') {
          await service.remove(linkId);
          return send(res, 200, { ok: true });
        }
        if (method === 'PATCH') {
          const body = (await readJson(req)) as { read?: unknown };
          if (typeof body.read !== 'boolean') throw new ValidationError('read must be a boolean');
          return send(res, 200, { link: await service.markRead(linkId, body.read) });
        }
      }

      if (method === 'GET' && (await serveStatic(res, pathname))) return;
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      if (err instanceof ValidationError) return send(res, 400, { error: err.message });
      if (err instanceof NotFoundError) return send(res, 404, { error: err.message });
      return send(res, 500, { error: 'internal error' });
    }
  };
}
