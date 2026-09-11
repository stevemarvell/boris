import { ValidationError } from './types.js';
import type { NewLink } from './types.js';

const MAX_TITLE = 200;

/** Normalises a tag to lowercase kebab, or throws if it cannot be one. */
export function normaliseTag(raw: string): string {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
  if (tag.length === 0) throw new ValidationError('tag must not be empty');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(tag)) {
    throw new ValidationError(`invalid tag: ${raw}`);
  }
  return tag;
}

export function normaliseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ValidationError(`invalid url: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(`unsupported protocol: ${parsed.protocol}`);
  }
  parsed.hash = '';
  return parsed.toString();
}

/** Falls back to the host + first path segment when no title is supplied. */
export function deriveTitle(url: string): string {
  const { host, pathname } = new URL(url);
  const segment = pathname.split('/').filter(Boolean)[0];
  return segment ? `${host}/${segment}` : host;
}

export interface ValidatedLink {
  readonly url: string;
  readonly title: string;
  readonly tags: readonly string[];
}

export function validateNewLink(input: NewLink): ValidatedLink {
  if (typeof input?.url !== 'string') throw new ValidationError('url is required');
  const url = normaliseUrl(input.url);

  const rawTitle = input.title?.trim();
  if (rawTitle !== undefined && rawTitle.length > MAX_TITLE) {
    throw new ValidationError(`title must be at most ${MAX_TITLE} characters`);
  }
  const title = rawTitle && rawTitle.length > 0 ? rawTitle : deriveTitle(url);

  const tags = [...new Set((input.tags ?? []).map(normaliseTag))].sort();
  return { url, title, tags };
}
