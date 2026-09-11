import type { Link } from '../domain/types.js';
import type { Store } from './store.js';

/** In-memory store. Used by tests and by `--ephemeral` runs. */
export class MemoryStore implements Store {
  readonly #links = new Map<string, Link>();

  constructor(seed: readonly Link[] = []) {
    for (const link of seed) this.#links.set(link.id, link);
  }

  async all(): Promise<Link[]> {
    return [...this.#links.values()];
  }

  async get(id: string): Promise<Link | undefined> {
    return this.#links.get(id);
  }

  async put(link: Link): Promise<void> {
    this.#links.set(link.id, link);
  }

  async delete(id: string): Promise<boolean> {
    return this.#links.delete(id);
  }
}
