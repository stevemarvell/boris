const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:8000';

export class ApiError extends Error {}

export interface PersonRef {
  readonly name: string;
}

export interface Person {
  readonly id: string;
  readonly name: string;
  readonly spouse: PersonRef | null;
  readonly parents: readonly PersonRef[];
  readonly children: readonly PersonRef[];
  readonly siblings: readonly PersonRef[];
}

export interface Generation {
  readonly depth: number;
  readonly people: readonly Person[];
}

/** Minimal GraphQL client. No library until the schema is big enough to need one. */
export async function graphql<T>(query: string): Promise<T> {
  const response = await fetch(`${API_URL}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) throw new ApiError(`API returned ${response.status}`);

  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new ApiError(body.errors[0]?.message ?? 'unknown GraphQL error');
  if (body.data === undefined) throw new ApiError('response contained no data');
  return body.data;
}

const GENERATIONS = `{
  generations {
    depth
    people {
      id
      name
      spouse { name }
      parents { name }
      children { name }
      siblings { name }
    }
  }
}`;

export async function fetchGenerations(): Promise<Generation[]> {
  const { generations } = await graphql<{ generations: Generation[] }>(GENERATIONS);
  return generations;
}
