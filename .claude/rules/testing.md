---
paths:
  - '**/*.test.ts'
  - '**/*.test.tsx'
  - 'tests/**'
  - 'src/renderer/src/test/**'
---

# Rule: tests

Tests are first-class code. This file holds the judgment part; the rest is enforced. Each line
names its sensor: a lint rule (`npm run lint`, also the PostToolUse hook), a guard test, or "prose
only".

## What a test proves

- **Behaviour through the public seam, not the internals.** Import the shipped module; assert what
  a caller or the operator sees. Prose only.
- **One behaviour per test.** The title states the behaviour and the condition ("a refused save
  shows the store-write copy"). Lint: `vitest/valid-title`, `vitest/no-identical-title`.
- **No branching in a test.** Lint: `vitest/no-conditional-in-test`, `vitest/no-conditional-expect`.
- **Every test asserts.** Lint: `vitest/expect-expect` (a helper named `expect*`/`assert*` counts).
- **No snapshots** (technical-taste §13). Lint: `vitest/no-restricted-matchers`.

## Renderer tests (jsdom)

- New tests render with React Testing Library: `render` + `screen` from `@testing-library/react`,
  `userEvent` from `@testing-library/user-event`, jest-dom matchers (`toHaveAttribute`,
  `toBeVisible`). `renderComponent`/`renderTracked` stay for old callers. Lint:
  `testing-library/*`, `jest-dom/*`.
- Query order: `getByRole` (with `name`) → `getByLabelText` → `getByText` → `getByTestId`. Never
  `container.querySelector` in a new test. Lint: `testing-library/no-container`,
  `testing-library/no-node-access`, `testing-library/prefer-screen-queries`.
- `userEvent` over `fireEvent`: it sends the events a real user causes. Prose only.

## Mocks, time, files

- Mock only at process edges: pty, fs, Electron, xterm, node built-ins (technical-taste §5b-21).
  Anything else is injected (a DI seam, a store reset). Guard: `tests/main/testHygiene.guard.test.ts`.
- Inject `now()`; no real sleeps. Use fake timers and turn them off in the same file. Guard:
  `testHygiene` (fake timers); lint `playwright/no-wait-for-timeout` in e2e.
- A test that makes a temp folder removes it. Guard: `testHygiene`.
- A test file stays under 1000 lines; split along `describe` blocks. Guard: `testHygiene`.

## Red first, never cheat

- Every new test or guard is seen red once, by breaking the code it protects
  (technical-taste §5b-2). Prose only (the `code-reviewer` agent repeats it).
- Never skip, delete or loosen a test to get green (§5b-3). Lint: `vitest/no-disabled-tests`,
  `playwright/no-skipped-test`, `.only` fails the run. The one allowed skip is a platform or
  privilege level the test cannot run under: `it.skipIf(...)` / `describe.runIf(...)`. Deleting or
  loosening: prose only.
- Repetition in a test body is fine. A shared test helper never serves one caller
  (maintainability rule 4). Prose only.

## Which layer

- `unit` (jsdom, renderer), `shared-node` and `main-unit` (node). Where a file goes:
  maintainability.md "Where a planned guard lives".
- e2e only for what crosses processes (pty, IPC, app lifecycle), always through
  `tests/e2e/fixtures.ts`. Use web-first assertions. Lint: `playwright/*`.
- Mutation testing (`npm run mutate`, StrykerJS) runs in the release clean-up pass (`release.md`
  step 0), never in the gate. Prose only.

## The lint budget

- `eslint-suppressions.json` holds the violations that existed when the test rules landed. It
  only shrinks; `tests/main/eslintSuppressions.guard.test.ts` pins its total.
- Fixed one? `npx eslint --prune-suppressions .`, then lower `PINNED_TOTAL` to the new total in
  the same commit.
- Moved or split a test file? `npx eslint --suppress-all <new path>`, then
  `npx eslint --prune-suppressions .`. The total must not change. Skip the prune and
  `npx eslint .` still passes (ESLint ignores entries for a path that is gone); only the pinned
  total catches it.
- Never run `--suppress-all` or `--suppress-rule` on the whole repo: the guard fails.
- The pin stops a rise, not a swap (fix one old hit, add a new one, re-suppress). Never
  re-suppress a new violation. Review rejects any count that goes up, or a new entry, in
  `eslint-suppressions.json`. If the fix and the new hit share a file and rule, only the source
  diff shows it.
