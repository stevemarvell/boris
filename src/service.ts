import { randomUUID } from 'node:crypto';
import { search } from './domain/search.js';
import type { Query } from './domain/search.js';
import { NotFoundError } from './domain/types.js';
import type { Link, NewLink } from './domain/types.js';
import { validateNewLink } from './domain/validate.js';
import type { Store } from './store/store.js';

export interface Clock {
  now(): Date;
}

const systemClock: Clock = { now: () => new Date() };

/** The application layer: everything the HTTP API and the CLI share. */
export class LinkService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID,
  ) {}

  async add(input: NewLink): Promise<Link> {
    const { url, title, tags } = validateNewLink(input);
    const existing = (await this.store.all()).find((l) => l.url === url);
    if (existing !== undefined) return existing;

    const link: Link = {
      id: this.newId(),
      url,
      title,
      tags,
      createdAt: this.clock.now().toISOString(),
      read: false,
    };
    await this.store.put(link);
    return link;
  }

  async list(query: Query = {}): Promise<Link[]> {
    return search(await this.store.all(), query);
  }

  async get(id: string): Promise<Link> {
    const link = await this.store.get(id);
    if (link === undefined) throw new NotFoundError(id);
    return link;
  }

  async markRead(id: string, read: boolean): Promise<Link> {
    const link = await this.get(id);
    const updated: Link = { ...link, read };
    await this.store.put(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    if (!(await this.store.delete(id))) throw new NotFoundError(id);
  }

  async tags(): Promise<{ tag: string; count: number }[]> {
    const counts = new Map<string, number>();
    for (const link of await this.store.all()) {
      for (const tag of link.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
}
