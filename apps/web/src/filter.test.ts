import { describe, expect, it } from 'vitest';
import type { Generation, Person } from './api';
import { countPeople, filterGenerations } from './filter';

function person(id: string, name: string): Person {
  return { id, name, spouse: null, parents: [], children: [], siblings: [] };
}

const GENERATIONS: Generation[] = [
  { depth: 0, people: [person('albert-shaw', 'Albert Shaw'), person('agnes-shaw', 'Agnes Shaw')] },
  { depth: 1, people: [person('nora-pike', 'Nora Pike')] },
  { depth: 2, people: [person('fred-shaw', 'Fred Shaw')] },
];

describe('filterGenerations', () => {
  it('returns everything for an empty query', () => {
    expect(countPeople(filterGenerations(GENERATIONS, ''))).toBe(4);
  });

  it('ignores surrounding whitespace', () => {
    expect(countPeople(filterGenerations(GENERATIONS, '   '))).toBe(4);
  });

  it('matches on part of a name, case insensitively', () => {
    const result = filterGenerations(GENERATIONS, 'FRE');
    expect(result.map((g) => g.people.map((p) => p.name))).toEqual([['Fred Shaw']]);
  });

  it('drops generations left with nobody', () => {
    const result = filterGenerations(GENERATIONS, 'nora');
    expect(result).toHaveLength(1);
    expect(result[0]?.depth).toBe(1);
  });

  it('keeps a generation that still has some matches', () => {
    const result = filterGenerations(GENERATIONS, 'shaw');
    expect(countPeople(result)).toBe(3);
    expect(result.map((g) => g.depth)).toEqual([0, 2]);
  });

  it('returns nothing when nobody matches', () => {
    expect(filterGenerations(GENERATIONS, 'zzz')).toEqual([]);
  });

  it('does not mutate the input', () => {
    filterGenerations(GENERATIONS, 'fred');
    expect(countPeople(GENERATIONS)).toBe(4);
  });
});
