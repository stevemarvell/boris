import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // e2e/ belongs to Playwright; vitest's default glob would claim it.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
