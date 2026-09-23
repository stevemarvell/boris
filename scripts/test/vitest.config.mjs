// The AI layer's own test suite (#173): hooks, the triage and drive-pr
// helpers, the census, contention, the Vercel scripts, the manifest. It used
// to live inside apps/web/src and run in the web app's jsdom suite, so the
// application carried the AI layer's tests and deleting it would have deleted
// them. Plain Node, not jsdom: nothing here touches a DOM.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});
