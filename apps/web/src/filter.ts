import type { Generation } from './api';

/**
 * Narrow the tree to people whose name matches, keeping the generation
 * grouping intact. Generations left with nobody are dropped, so the headings
 * never claim people that are not shown.
 */
export function filterGenerations(
  generations: readonly Generation[],
  query: string,
): Generation[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...generations];

  return generations
    .map((generation) => ({
      ...generation,
      people: generation.people.filter((person) => person.name.toLowerCase().includes(needle)),
    }))
    .filter((generation) => generation.people.length > 0);
}

export function countPeople(generations: readonly Generation[]): number {
  return generations.reduce((total, generation) => total + generation.people.length, 0);
}
