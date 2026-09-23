// @ts-check
// Lint for the AI layer's tests, the same rules they had inside apps/web
// minus React's (#173).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  files: ['**/*.ts'],
  rules: {
    '@typescript-eslint/consistent-type-imports': 'error',
  },
});
