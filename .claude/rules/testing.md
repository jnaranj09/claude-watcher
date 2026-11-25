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
- **No global coverage percentage as a target.** Coverage barely predicts whether tests catch
  faults; fault injection and mutation testing instead. Per-function coverage only feeds the CRAP
  score (see "Risky code"), never a number to reach. Prose only.

## Every test earns its place

- **A test names the fault that would turn it red.** No tests of getters, framework code,
  constants or the mock itself; no assertion that cannot fail (`expect(true)`, "does not throw"
  alone); no near-copy tests that differ only in data (use `it.each`). Lint: `vitest/expect-expect`;
  the rest is prose only, checked by the reviewer's "Test value" check.
- **A test written only to raise a number is a finding.** Prose only.
- **Low-value tests are reported, never deleted by the agent.** The clean-up pass lists tests that
  kill no mutant; the owner decides. Sensor: StrykerJS (`npm run mutate`, run by hand).

## Risky code

- **Complexity cap.** A function over the cap (10) is split or simplified. Lint: ESLint
  `complexity` (every linted file, tests too); hits that existed when it landed sit in
  `eslint-suppressions.json`.
- **CRAP limit.** A function's CRAP score (CC² × (1 − coverage)³ + CC, per-function coverage from
  `npm run test:coverage`) stays at or under 30; old offenders sit in `crap-allow.json`, a pinned
  list that only shrinks: a test that lowers a pinned score lowers its pin in the same commit, and
  one now under the limit leaves the list. Sensor: `npm run crap` (`tools/crap/`), and in CI the
  same check with `--base-allow` (main's copy of the list: a new entry or a higher pin fails).
  Guard: `tests/main/crapBudget.guard.test.ts` (CI keeps the step, the limit, the list, the base
  copy and the `src/mod` exclusion).
- **Behaviour has a plain scenario** (Given / When / Then, as `test.step` titles) through the
  public surface, in `tests/acceptance/*.scenario.ts`, added in the same change as the behaviour;
  never edited to match a changed result without the owner. Sensor: `npm run test:acceptance`
  (Playwright-Electron on the built app, local only: most scenarios launch a real `claude`);
  editing to match is reviewer only.

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
- A test that needs a clock-change zone is named `*.zone.test.ts` (any folder): it runs in the
  `zone-berlin` project (node, `forks`, TZ Europe/Berlin), and every other project skips it. Setting
  TZ inside a test does nothing: every worker thread shares the runner's zone. Guard:
  `tests/main/vitestConfig.guard.test.ts`.
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
