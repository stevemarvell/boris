import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

function mockGraphql(data: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => ({ data }) }),
  );
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

  it('renders an empty tree without crashing', async () => {
    mockGraphql({ generations: [] });
    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull());
    expect(screen.queryAllByTestId('person')).toHaveLength(0);
  });

  it('shows an error rather than a blank page when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('error')).toBeTruthy());
    expect(screen.getByTestId('error').textContent).toContain('503');
  });
});
