---
"@hasna/files": minor
---

Add an explicit token-bounded page contract without breaking existing Files JSON consumers. `files list --json`, `files search --json`, `list_files`, and `search_files` preserve their historical full bare-array defaults. CLI callers opt into compact receipts with `--agent-json`; MCP callers use `format: "page"`. CLI page-only controls, including explicit `--detail compact`, reject unless `--agent-json` is selected, and compact detail is defaulted only after that mode selection. Page mode provides truthful continuation, byte-budget receipts, allowlisted fields, explicit full page detail, and a 500-row page cap.

Add bounded exhaustive reads through CLI `--all` and MCP `all: true`. Exhaustive mode requires the receipt-bearing compact contract, starts at offset zero, walks bounded service pages, and refuses if the whole query exceeds 5,000 rows or 1 MiB. `_meta.end_reached` reports tail status; `_meta.complete` is true only when the response covers the whole query from offset zero.

Keep the minimal/standard/full MCP profiles, capability and transport filtering, exact `get_file` path, hosted `/v1` authority behavior, and fail-closed local-store boundary. Hosted context-pack remains unavailable pending an owned tenant-scoped, revision-aware service contract. Local search continues to scan filtered candidates to true exhaustion with deterministic rank/id ordering.
