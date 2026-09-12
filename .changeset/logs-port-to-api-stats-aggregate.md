---
"@hasna/logs": minor
---

`logs stats` now reads a server-side aggregate instead of downloading the
corpus.

The command used to ask the API for `listLogs({ limit: 100000 })` and fold up
to a hundred thousand records in the client to print a few dozen numbers. A new
`GET /v1/logs/stats` route answers the same overview — totals, the level and
service breakdowns, the daily histogram and the oldest/newest timestamps —
computed where the data lives. One request replaces the scan.

`stats` also gains `--days <n>` to size the daily histogram (default 7); the
window now applies to the aggregate rather than being filtered client-side.

The `log_stats` MCP tool still uses the old client-side path and is ported in a
follow-up.
