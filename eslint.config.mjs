import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import vitestPlugin from '@vitest/eslint-plugin'
import playwrightPlugin from 'eslint-plugin-playwright'
import testingLibraryPlugin from 'eslint-plugin-testing-library'
import jestDomPlugin from 'eslint-plugin-jest-dom'
// Story 0.2 — authored local rule banning string-literal IPC channels.
import localIpc from './eslint-rules/no-literal-channels.js'
// Story 0.3 (Task 6) — type-checked lint rules need the typescript-eslint parser
// + parserOptions.project, else `no-floating-promises` silently no-ops.
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

// Test rules are all `error`: bulk suppressions record errors only, and `npm run lint` does not
// fail on warnings. `.claude/rules/testing.md` says what each rule protects.
const asErrors = (rules) =>
  Object.fromEntries(
    Object.entries(rules).map(([id, v]) => {
      const level = Array.isArray(v) ? v[0] : v
      if (level === 'off' || level === 0) return [id, v]
      return [id, Array.isArray(v) ? ['error', ...v.slice(1)] : 'error']
    })
  )

export default defineConfig(
  {
    // The __fixtures__ are intentionally (non-)conformant inputs that demonstrate
    // the rule fires on the bad case; they are excluded from the repo lint gate so
    // `npm run lint` stays green. Demonstrate the rule on them with a targeted run:
    //   npx eslint eslint-rules/__fixtures__/bad-literal-channel.ts   (reports)
    //   npx eslint eslint-rules/__fixtures__/good-ch-channel.ts       (clean)
    // The AUTOMATED pass/fail runner (Vitest) is Story 0.3.
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      'eslint-rules/__fixtures__/**',
      // Vendored agent skills (beaf0c7): third-party scripts, not app code.
      '.agents/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // Story 0.2 — enforce the typed IPC seam: no string-literal channels.
    // Applied to source AND the fixtures (the fixtures are scoped by their own
    // targeted runs above for the demonstration; this registers the rule so it
    // is active wherever IPC is called).
    files: ['src/**/*.{ts,tsx}', 'eslint-rules/__fixtures__/**/*.{ts,tsx}'],
    plugins: {
      'local-ipc': localIpc
    },
    rules: {
      'local-ipc/no-literal-channels': 'error'
    }
  },
  {
    // Story 0.3 (Task 6) — TYPE-CHECKED lint for the real source + tests.
    // `no-floating-promises` requires type information (parserOptions.project),
    // or it silently no-ops (architecture.md#Enforcement warns about exactly
    // this). We scope the type-aware parser to the project's own *.{ts,tsx} so the
    // cost is bounded; the PostToolUse hook lints a SINGLE file with --cache, so
    // type-checked rules on one file stay well inside the <2s budget.
    // `consistent-type-imports` enforces `import type` for type-only imports
    // (the codebase already follows this; the rule makes it non-optional).
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // The build + test tsconfigs together cover every src + test file. Using
        // multiple projects lets the parser find the right program per file.
        project: ['./tsconfig.node.json', './tsconfig.web.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // technical-taste §5b-10: a switch over a union names every member (or has a `default`), so
      // a new member is a lint error in every switch that forgot it.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true }
      ]
    }
  },
  {
    // The base TS config (`@electron-toolkit/eslint-config-ts`) disables
    // type-annotation-only TS rules for `*.js`/`*.mjs`, but its glob is the
    // bare filename — which in flat config matches ONLY root-level files, so it
    // misses `.mjs` files in subdirectories (e.g. `tests/smoke/*.mjs`). A plain
    // JS module can never carry TS return-type annotations, so this recursive
    // `**/*.mjs` override re-disables the type-annotation-only TS rules for ALL
    // `.mjs` files — clearing the false-positive errors on the smoke runner.
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off'
    }
  },
  {
    // technical-taste §5b-3 / §5b-21 / §13 as lint: every Vitest test file.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    plugins: { vitest: vitestPlugin },
    rules: asErrors({
      ...vitestPlugin.configs.recommended.rules,
      'vitest/no-conditional-in-test': 'error',
      'vitest/prefer-hooks-on-top': 'error',
      // Vitest's `expect(value, message)` takes a message.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      // A guard may assert through a named helper.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect*', 'assert*'] }],
      'vitest/no-restricted-matchers': [
        'error',
        {
          toMatchSnapshot: 'No snapshot tests (technical-taste §13): assert the value.',
          toMatchInlineSnapshot: 'No snapshot tests (technical-taste §13): assert the value.',
          toThrowErrorMatchingSnapshot: 'No snapshot tests (technical-taste §13).',
          toThrowErrorMatchingInlineSnapshot: 'No snapshot tests (technical-taste §13).'
        }
      ]
    })
  },
  {
    // Renderer (jsdom) tests: user-facing queries and jest-dom matchers (§5b-21).
    files: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
    plugins: { 'testing-library': testingLibraryPlugin, 'jest-dom': jestDomPlugin },
    settings: {
      // The house wrappers render too, so their callers get the same checks.
      'testing-library/custom-renders': ['renderComponent', 'renderTracked', 'renderApp']
    },
    rules: asErrors({
      ...testingLibraryPlugin.configs['flat/react'].rules,
      ...jestDomPlugin.configs['flat/recommended'].rules,
      // Style only (the house names a render result `r`); it guards no behaviour.
      'testing-library/render-result-naming-convention': 'off'
    })
  },
  {
    // Playwright e2e: web-first waits, no sleeps, no force, no skips.
    files: ['tests/e2e/**/*.ts'],
    ...playwrightPlugin.configs['flat/recommended'],
    rules: {
      ...asErrors(playwrightPlugin.configs['flat/recommended'].rules),
      // The preset turns this off for Playwright's `({}, use)` fixtures; keep it on so each empty
      // pattern still carries its own disable comment (`tests/e2e/fixtures.ts`).
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: false }]
    }
  },
  eslintConfigPrettier
)
