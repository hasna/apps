---
"@hasna/mementos": patch
---

`mementos-mcp` now fails closed at startup, not only per tool call. With no fleet API credential resolvable and no explicit local opt-in the MCP server exits non-zero naming the required tiers (the same `MEMENTOS_STORE_CONFIG` refusal the CLI prints) before it does anything else. The companion `mementos-serve` process, which serves the on-box SQLite store, is spawned only under an explicit local opt-in (`HASNA_MEMENTOS_DB_PATH` / `HASNA_MEMENTOS_LOCAL=1`); a hosted MCP no longer creates `~/.hasna/mementos/mementos.db` as a side effect of starting. Found by the independent 0.15.0 release review.
