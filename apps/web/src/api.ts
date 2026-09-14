const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:8000';

/**
 * How long one request may take before the client gives up on it.
 *
 * Chosen to be generous rather than tight. `railway.json` sets
 * `sleepApplication: true`, so the first request after an idle period wakes a
 * sleeping container, and that wake is measured in seconds — occasionally tens
 * of seconds. A short timeout would turn a working slow path into a visible
 * failure, which is worse than the hang this closes.
 *
 * Thirty seconds is the number this repository already treats as the ceiling
 * for a single attempt: `smoke` polls the deployed API with `curl --max-time
 * 30`. Smoke gets its patience from repeating thirty times; a browser gets its
 * from the one automatic retry in `App.tsx` and then from the retry button, so
 * the user waits at most about a minute before being handed the controls.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/** A `Retry-After` further out than this is treated as "no useful hint". */
const RETRY_AFTER_CAP_MS = 5 * 60_000;

/**
 * Why a request failed. The distinction that matters is `rate-limited`: the
 * deployed API caps `/graphql` per caller, and retrying a 429 is the one
 * response that makes the situation worse rather than better.
 */
export type ApiFailure = 'timeout' | 'offline' | 'rate-limited' | 'http' | 'graphql';

export class ApiError extends Error {
  readonly failure: ApiFailure;
  /** What the server's `Retry-After` asked for, in milliseconds, if anything. */
  readonly retryAfterMs: number | null;

  constructor(message: string, failure: ApiFailure = 'http', retryAfterMs: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.failure = failure;
    this.retryAfterMs = retryAfterMs;
  }
}

/** `Retry-After` is either a count of seconds or an HTTP date. Accept both. */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | null {
  if (header === null || header === undefined || header.trim() === '') return null;

  const clamp = (ms: number): number => Math.min(Math.max(ms, 0), RETRY_AFTER_CAP_MS);

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return clamp(seconds * 1000);

  const when = Date.parse(header);
  if (Number.isNaN(when)) return null;
  return clamp(when - now);
}

interface Deadline {
  readonly signal: AbortSignal;
  /** Releases the timer. A no-op where the platform owns it. */
  readonly settled: () => void;
}

/**
 * `AbortSignal.timeout` landed in Chrome 103, Firefox 100 and Safari 16, but
 * this bundle targets further back than that: Vite's default build target here
 * resolves to `safari14, chrome87, firefox78, edge88`, and Ionic 8 supports
 * Safari 14 as well. A build target only rewrites syntax — it never polyfills a
 * runtime API — so calling `AbortSignal.timeout` unguarded would throw on load
 * in exactly the older browsers the build claims to serve. Use it where it
 * exists; fall back to the controller and timer it is sugar for where it does
 * not.
 */
function startDeadline(ms: number): Deadline {
  if (typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), settled: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`signal timed out after ${ms}ms`, 'TimeoutError'));
  }, ms);
  return { signal: controller.signal, settled: () => clearTimeout(timer) };
}

function wasAborted(signal: AbortSignal, err: unknown): boolean {
  if (signal.aborted) return true;
  // Read `name` off the value rather than narrowing with `instanceof Error`:
  // the rejection is a DOMException, and jsdom's DOMException does not inherit
  // from Error, so an instanceof check quietly misfiles every timeout as a
  // network failure.
  const name = (err as { name?: unknown } | null | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

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
export async function graphql<T>(query: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const { signal, settled } = startDeadline(timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal,
    });
  } catch (err) {
    if (wasAborted(signal, err)) {
      throw new ApiError(
        `the server did not answer within ${Math.round(timeoutMs / 1000)} seconds; it may be waking up`,
        'timeout',
      );
    }
    throw new ApiError('the server could not be reached', 'offline');
  } finally {
    settled();
  }

  // The deployed API rate-limits /graphql per caller and says when to come
  // back. Kept distinct from every other failure precisely so that nothing
  // retries it automatically.
  if (response.status === 429) {
    throw new ApiError(
      'the server is receiving too many requests',
      'rate-limited',
      parseRetryAfter(response.headers.get('retry-after')),
    );
  }

  if (!response.ok) throw new ApiError(`API returned ${response.status}`);

  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length)
    throw new ApiError(body.errors[0]?.message ?? 'unknown GraphQL error', 'graphql');
  if (body.data === undefined) throw new ApiError('response contained no data', 'graphql');
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
