---
"@hasna/mementos": minor
---

Add explicit `--agent-json` receipt mode for token-bounded `list` and `history` reads while preserving historical `--json` and `--format json` full bare-array compatibility. Agent JSON defaults to compact 20-row list and 10-row history pages with truthful continuation metadata and exact response-byte accounting.

Keep `--all`, `--full`, and `--max-bytes` as receipt-only controls. Agent JSON pages refuse limits above 1,000 rows; exhaustive reads start at offset zero and fail closed above 5,000 rows or 1 MiB. Add deterministic `id DESC` tie-breakers to list and history ordering, and declare that offset continuations are non-overlapping only while the result set is unchanged.

Document the required `HASNA_MEMENTOS_LOCAL=1` opt-in for local SQLite quick-start use. Hosted traversal remains on the canonical Mementos authority with exactly one `/v1` suffix and never falls back locally.
