---
"@hasna/mementos": patch
---

Ensure large `mementos --json agents` listings are written completely before the CLI exits, so callers receive parseable JSON instead of a successful truncated stream.
