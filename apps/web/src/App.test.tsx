import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  // <ion-app>'s own componentDidLoad schedules a real timer (ion-app.js's
  // `rIC` helper falls back to `setTimeout(fn, 32)` because jsdom has no
  // requestIdleCallback) from an async lifecycle that runs on a later
  // frame, not synchronously inside render(). If cleanup() unmounts before
  // that lifecycle has run, the timer gets scheduled on the now-
  // disconnected element anyway, and nothing is left to cancel it -
  // ion-app's disconnectedCallback only clears a timer it already knows
  // about. The orphaned timer then fires once Vitest tears the jsdom
  // environment down for this file, raising "ReferenceError: window is not
  // defined" from Timeout._onTimeout (issue #217). Flushing every pending
  // timer, and the microtasks they drive, before cleanup gives that
  // lifecycle a chance to finish - and its disconnectedCallback a chance to
  // cancel the timer - while jsdom is still alive.
  await vi.runAllTimersAsync();
  cleanup();
  vi.useRealTimers();
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

  it('cancels the timer ion-app schedules instead of leaving it to fire after teardown', async () => {
    // Regression test for issue #217. Spy on the real setTimeout so we can
    // see whether anything still schedules ion-app's 32ms timer *after*
    // the element is unmounted — that is exactly the leak: a timer with
    // nothing left able to cancel it, which fires once jsdom is gone.
    const scheduledAfterUnmount: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    let unmounted = false;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (unmounted && timeout === 32) {
        scheduledAfterUnmount.push(timeout);
      }
      return realSetTimeout(handler as VoidFunction, timeout, ...args);
    }) as typeof setTimeout);

    const { unmount } = render(<App />);
    // Let ion-app's own componentDidLoad lifecycle - and the setTimeout it
    // schedules - run while the element is still connected, exactly as the
    // afterEach above does before it calls cleanup().
    await vi.runAllTimersAsync();
    unmount();
    unmounted = true;
    // Give anything still in flight a chance to (mis)schedule more work on
    // the disconnected element, so a regression here would be caught.
    await vi.runAllTimersAsync();

    setTimeoutSpy.mockRestore();
    expect(scheduledAfterUnmount).toEqual([]);
  });
});
