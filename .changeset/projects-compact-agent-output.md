---
"@hasna/projects": minor
---

Add byte- and row-bounded compact project list/search output for agents without changing the legacy full JSON or `projects_list` contracts. The CLI now supports compact/full detail, field projection, explicit complete reads, minified or pretty JSON, safer query scopes, and continuation metadata; MCP adds `projects_search` with the same compact bounded semantics. Hosted `/v1/projects` and local stores apply equivalent explicit query-scope and eval-exclusion filters before pagination and counting, and hosted compact clients require the server's exact `projects.list.v2` filter attestation instead of trusting an older deployment that may ignore additive filters.
