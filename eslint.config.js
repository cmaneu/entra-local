// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-sea/**',
      'node_modules/**',
      'portal/dist/**',
      'data/**',
      'coverage/**',
      'samples/**',
      'docs/**',
      'scripts/**',
      // Cross-platform MSAL compat smoke-tests (#13): C#/Python projects + their build artifacts
      // (.venv, bin/, obj/) are not part of the TS lint surface.
      'test/compat/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The React + TSX portal (#12) runs in the browser; enable JSX + the hooks rules.
    files: ['portal/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
