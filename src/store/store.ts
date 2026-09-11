import type { Link } from '../domain/types.js';

export interface Store {
  all(): Promise<Link[]>;
  get(id: string): Promise<Link | undefined>;
  put(link: Link): Promise<void>;
  delete(id: string): Promise<boolean>;
}
