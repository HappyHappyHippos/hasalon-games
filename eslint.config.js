import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Lint config.
 *
 * Scope is deliberately narrow. `tsc --noEmit` already runs in strict mode with
 * `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` and
 * `noImplicitOverride`, so this does not repeat any of that — rules that
 * duplicate the compiler are turned off below rather than left to fire twice.
 *
 * What it adds that the compiler cannot:
 *
 * - **react-hooks**, which is the reason this exists at all. Seven files carried
 *   `// eslint-disable-next-line react-hooks/exhaustive-deps` with no linter
 *   behind them, so those suppressions were decoration. They mean something now.
 * - **`scripts/`**, which is plain `.mjs` and therefore has no typecheck at all.
 *   Lint is the only automated check those 2,000-odd lines get.
 *
 * There is no formatting rule here and no Prettier, on purpose: the codebase is
 * already consistently formatted, and a repo-wide reformat would rewrite blame
 * on every file to fix nothing.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'coverage/**',
      'packages/client/public/**',
      // Throwaway bots and probes, per CLAUDE.md's testing recipe.
      '**/*.tmp.*',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // The compiler already reports these, with better positions. Leaving them
      // on means every unused import is two errors in two tools.
      '@typescript-eslint/no-unused-vars': 'off',

      // `verbatimModuleSyntax` is on, so type-only imports already have to be
      // marked. This keeps them all written the same way.
      //
      // `disallowTypeAnnotations: false` because inline `import('./x').Thing` in
      // type position is the normal way to name a type in a test helper without
      // dragging the module into the import list, and there is no reason to
      // forbid it.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
          disallowTypeAnnotations: false,
        },
      ],

      // The codebase has none of these and should keep having none. `any` is
      // absent from packages/ entirely; that is worth defending mechanically
      // rather than by review.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',

      // An empty catch is how a swallowed failure hides. Every one of the catch
      // blocks here has a body and a comment explaining the fallback.
      'no-empty': ['error', { allowEmptyCatch: false }],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // Shared runs on both sides, so it gets no DOM and no node globals.
  {
    files: ['packages/shared/**/*.ts'],
    languageOptions: { globals: {} },
  },

  {
    files: ['packages/server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Client: React, browser globals, and the hooks rules.
  {
    files: ['packages/client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // Scripts are plain node ESM, hand-run, and not typechecked. Lint is the only
  // check they get, which is exactly why they are not ignored here.
  {
    files: ['scripts/**/*.mjs', '*.config.{js,mjs}', 'vitest.config.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // Tests reach into internals and stub things the app never would.
  {
    files: ['**/*.test.{ts,tsx}'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
