---
"@hasna/mementos": minor
---

Default the Mementos MCP server to a bounded 23-tool `core` profile and add
additive `search`, `graph`, `automation`, `admin`, `storage`, `hooks`, and
`full` profiles. Reduced profiles no longer advertise the legacy unpaged
collection resources; `full` preserves the complete 123-tool compatibility
surface. Tool discovery is bounded and active-profile aware, and full
`memory_list` responses now return redacted, minified, byte-bounded page
envelopes with truthful continuation metadata. This intentionally replaces the
legacy bare full-list array; callers read records from `items` and continuation
from `_meta`.
