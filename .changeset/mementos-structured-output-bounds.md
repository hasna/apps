---
"@hasna/mementos": minor
---

Bound CLI JSON collection reads by default and replace bare list/history arrays with minified `{ memories, _meta }` page receipts. `list` now defaults to 20 compact rows and `history` to 10, with truthful cursors, no-overlap continuation, exact response-byte accounting, and configurable byte budgets.

Add explicit `--full` detail and `--all` exhaustion controls. JSON pages refuse limits above 1,000 rows; exhaustive reads start at offset zero and fail closed above 5,000 rows or 1 MiB instead of returning success-shaped partial data. Hosted traversal remains on the canonical Mementos authority with exactly one `/v1` suffix and never falls back to a local store.
