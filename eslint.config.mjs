import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
// Story 0.2 — authored local rule banning string-literal IPC channels.
import localIpc from './eslint-rules/no-literal-channels.js'
// Story 0.3 (Task 6) — type-checked lint rules need the typescript-eslint parser
// + parserOptions.project, else `no-floating-promises` silently no-ops.
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

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
  eslintConfigPrettier
)
