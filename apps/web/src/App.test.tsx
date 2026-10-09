import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    // Stubbed to a literal distinct from the real project name — asserting
    // against __APP_NAME__ itself would compare the component's value to
    // itself, which can't fail. If App.tsx ever hardcodes a string, the
    // stub has no effect on it and this fails.
    vi.stubGlobal('__APP_NAME__', 'stand-in-app');
    render(<App />);
    expect(screen.getByText('stand-in-app')).toBeTruthy();
  });

  it('calls no API', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<App />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
