import type { Link } from './types.js';

export interface Query {
  readonly text?: string;
  readonly tag?: string;
  readonly unreadOnly?: boolean;
}

function score(link: Link, text: string): number {
  const needle = text.toLowerCase();
  let points = 0;
  if (link.title.toLowerCase().includes(needle)) points += 3;
  if (link.url.toLowerCase().includes(needle)) points += 2;
  if (link.tags.some((t) => t.includes(needle))) points += 1;
  return points;
}

/** Ranked search. Newest first when scores tie. */
export function search(links: readonly Link[], query: Query): Link[] {
  const byRecency = (a: Link, b: Link): number => b.createdAt.localeCompare(a.createdAt);

  let matches = [...links];
  if (query.unreadOnly === true) matches = matches.filter((l) => !l.read);
  if (query.tag !== undefined) {
    const tag = query.tag.toLowerCase();
    matches = matches.filter((l) => l.tags.includes(tag));
  }

  const text = query.text?.trim();
  if (text === undefined || text.length === 0) return matches.sort(byRecency);

  return matches
    .map((link) => ({ link, points: score(link, text) }))
    .filter(({ points }) => points > 0)
    .sort((a, b) => b.points - a.points || byRecency(a.link, b.link))
    .map(({ link }) => link);
}
