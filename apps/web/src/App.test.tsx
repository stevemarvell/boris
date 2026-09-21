import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Generation, Person } from './api';

function person(over: Partial<Person> & Pick<Person, 'id' | 'name'>): Person {
  return { spouse: null, parents: [], children: [], siblings: [], ...over };
}

const GENERATIONS: Generation[] = [
  {
    depth: 0,
    people: [person({ id: 'albert-shaw', name: 'Albert Shaw', spouse: { name: 'Agnes Shaw' } })],
  },
  {
    depth: 1,
    people: [
      person({
        id: 'fred-shaw',
        name: 'Fred Shaw',
        spouse: { name: 'Ellie Shaw' },
        parents: [{ name: 'Frank Shaw' }],
        siblings: [{ name: 'Sally Baker' }],
        children: [{ name: 'Daisy Shaw' }, { name: 'Sam Shaw' }],
      }),
      person({ id: 'nora-pike', name: 'Nora Pike' }),
    ],
  },
];

function okResponse(data: unknown) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data }) };
}

function mockGraphql(data: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      headers: { get: () => null },
      json: async () => ({ data }),
    }),
  );
}

/**
 * What `fetch` does when an `AbortSignal.timeout` fires: a DOMException named
 * TimeoutError. Rejecting with it immediately keeps the test fast while driving
 * exactly the branch a thirty-second hang would.
 */
function timedOut(): DOMException {
  return new DOMException('signal timed out', 'TimeoutError');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows a spinner before the tree arrives', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<App />);
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('renders every generation and every person', async () => {
    mockGraphql({ generations: GENERATIONS });
    render(<App />);

    await waitFor(() => expect(screen.getAllByTestId('generation')).toHaveLength(2));
    expect(screen.getAllByTestId('person')).toHaveLength(3);
    expect(screen.getByText('Generation 1')).toBeTruthy();
    expect(screen.getByText('Fred Shaw')).toBeTruthy();
  });

  it('shows derived relationships for a person', async () => {
    mockGraphql({ generations: GENERATIONS });
    render(<App />);

    await waitFor(() => expect(screen.getByText('Fred Shaw')).toBeTruthy());
    const fred = document.querySelector('[data-person-id="fred-shaw"]');
    expect(fred?.textContent).toContain('Ellie Shaw');
    expect(fred?.textContent).toContain('Sally Baker');
    expect(fred?.textContent).toContain('Daisy Shaw, Sam Shaw');
  });

  it('renders someone with no relationships at all', async () => {
    mockGraphql({ generations: GENERATIONS });
    render(<App />);

    await waitFor(() => expect(screen.getByText('Nora Pike')).toBeTruthy());
    const nora = document.querySelector('[data-person-id="nora-pike"]');
    expect(nora?.textContent).toContain('No recorded relationships');
  });

  it('says the tree is empty rather than blaming an empty filter', async () => {
    mockGraphql({ generations: [] });
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('empty-tree')).toBeTruthy());
    expect(screen.getByTestId('empty-tree').textContent).toContain('No people recorded yet');
    expect(screen.queryByTestId('no-matches')).toBeNull();
    expect(screen.queryAllByTestId('person')).toHaveLength(0);
  });

  it('filters the tree by name and reports how many matched', async () => {
    mockGraphql({ generations: GENERATIONS });
    render(<App />);
    await waitFor(() => expect(screen.getAllByTestId('person')).toHaveLength(3));

    const input = document.querySelector('ion-searchbar input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'fred' } });

    await waitFor(() => expect(screen.getAllByTestId('person')).toHaveLength(1));
    expect(screen.getByTestId('match-count').textContent).toContain('1 of 3');
    // The generation Fred is not in should disappear along with its heading.
    expect(screen.getAllByTestId('generation')).toHaveLength(1);
  });

  it('says so when nobody matches', async () => {
    mockGraphql({ generations: GENERATIONS });
    render(<App />);
    await waitFor(() => expect(screen.getAllByTestId('person')).toHaveLength(3));

    const input = document.querySelector('ion-searchbar input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'zzz' } });

    await waitFor(() => expect(screen.getByTestId('no-matches')).toBeTruthy());
    expect(screen.getByTestId('no-matches').textContent).toContain('zzz');
    expect(screen.queryByTestId('empty-tree')).toBeNull();
    expect(screen.queryAllByTestId('person')).toHaveLength(0);
  });

  it('shows an error rather than a blank page when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('error')).toBeTruthy());
    expect(screen.getByTestId('error').textContent).toContain('503');
    expect(screen.getByTestId('retry')).toBeTruthy();
  });

  it('retries a timed-out first load by itself, and says it is still waiting', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timedOut())
      .mockResolvedValue(okResponse({ generations: GENERATIONS }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    // The cold start the request itself triggered is about to finish, so the
    // user should never see a failure — only that something is still happening.
    await waitFor(() => expect(screen.getByTestId('waking')).toBeTruthy());
    expect(screen.queryByTestId('error')).toBeNull();

    await waitFor(() => expect(screen.getAllByTestId('person')).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after the one automatic retry and hands over a button', async () => {
    const fetchMock = vi.fn().mockRejectedValue(timedOut());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('error')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('error').textContent).toContain('did not answer');
  });

  it('loads the tree when the retry button is pressed', async () => {
    const fetchMock = vi.fn().mockRejectedValue(timedOut());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('retry')).toBeTruthy());
    fetchMock.mockResolvedValue(okResponse({ generations: GENERATIONS }));
    fireEvent.click(screen.getByTestId('retry'));

    await waitFor(() => expect(screen.getAllByTestId('person')).toHaveLength(3));
    expect(screen.queryByTestId('error')).toBeNull();
  });

  it('never retries a rate limit automatically, and holds the button off', async () => {
    // 120 requests a minute per caller, and a retry is the one response that
    // makes that worse. One request, then a disabled button.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => '30' },
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('error')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('error').textContent).toContain('too many requests');
    await waitFor(() => expect(screen.getByTestId('retry').textContent).toContain('shortly'));

    // And pressing it anyway sends nothing.
    fireEvent.click(screen.getByTestId('retry'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-enables the retry button once Retry-After has elapsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: () => '0.05' },
        json: async () => ({}),
      }),
    );
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('retry').textContent).toContain('shortly'));
    await waitFor(() => expect(screen.getByTestId('retry').textContent).not.toContain('shortly'));
  });
});
