---
"@hasna/knowledge": patch
---

Raise the knowledge suite's test budget to the measured safe margin (20000ms per test, the budget the package's own CI defines in apps/knowledge/.github/workflows/ci.yml) in the package test script. The monorepo CI runs the package's `test` script serially on a 4-core runner, where bun's 5000ms default budget is exceeded by spawn-heavy tests under worker contention — measured: `bun test --parallel=4` timed out `public knowledge sdk > exposes a stable client facade for installed apps` at 5195ms (1 fail, exit 1); the same shape with `--timeout 20000` passes 470/2/0 with exit 0. No test is weakened or skipped; the explicit per-test budgets via `tests/support/budget.ts` are unchanged.
