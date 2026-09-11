import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Link } from '../domain/types.js';
import type { Store } from './store.js';

/**
 * JSON file store. Writes go through a temp file + rename so a crash
 * mid-write cannot leave a half-written database behind.
 */
export class FileStore implements Store {
  #cache: Map<string, Link> | undefined;

  constructor(private readonly path: string) {}

  async #load(): Promise<Map<string, Link>> {
    if (this.#cache !== undefined) return this.#cache;
    try {
      const raw = await readFile(this.path, 'utf8');
      const links = JSON.parse(raw) as Link[];
      this.#cache = new Map(links.map((l) => [l.id, l]));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.#cache = new Map();
    }
    return this.#cache;
  }

  async #flush(): Promise<void> {
    const links = [...(await this.#load()).values()];
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(links, null, 2), 'utf8');
    await rename(tmp, this.path);
  }

  async all(): Promise<Link[]> {
    return [...(await this.#load()).values()];
  }

  async get(id: string): Promise<Link | undefined> {
    return (await this.#load()).get(id);
  }

  async put(link: Link): Promise<void> {
    (await this.#load()).set(link.id, link);
    await this.#flush();
  }

  async delete(id: string): Promise<boolean> {
    const removed = (await this.#load()).delete(id);
    if (removed) await this.#flush();
    return removed;
  }
}
