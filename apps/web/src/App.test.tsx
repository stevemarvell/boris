import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('App', () => {
  it('renders the shell', () => {
    render(<App />);
    expect(screen.getByTestId('shell')).toBeTruthy();
  });

  it('links to the documentation the deployment still serves', () => {
    render(<App />);
    const link = screen.getByRole('link', { name: 'The project documentation' });
    expect(link.getAttribute('href')).toBe('/docs/');
  });

  it("titles the toolbar from the project's own name, not a hardcoded one", () => {
    render(<App />);
    expect(screen.getByText(__APP_NAME__)).toBeTruthy();
  });

  it('calls no API', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<App />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
