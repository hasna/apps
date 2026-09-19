---
"@hasna/files": minor
---

Make bounded compact collection output the default for Files agents. `files list --json` and `files search --json` now emit minified receipt-bearing pages capped at 20 rows and 32 KiB by default; `list_files` and `search_files` use the same default MCP contract. Every page carries deterministic query-bound `cursor` / `next_cursor` metadata alongside `next_offset`, truthful tail/completeness flags, projected fields, and an exact serialized-byte receipt.

Preserve explicit compatibility escapes: CLI callers use `--json --full` for the historical full bare array, MCP callers set `format: "legacy"`, and the existing `--agent-json` spelling remains a deprecated alias for compact CLI pages. Cursors reject cross-query, cross-tool, malformed, and cursor-plus-offset reuse before a read. Byte-limited pages encode continuation from the emitted row count so omitted rows remain reachable through the route's existing offset semantics.

Keep exhaustive output opt-in and hard bounded at 5,000 rows / 1 MiB. Hosted reads still resolve `https://api.hasna.com/files` credentials fresh per request and append exactly one `/v1`; no local fallback, authority change, server route, deployment workflow, or release branch is included.
