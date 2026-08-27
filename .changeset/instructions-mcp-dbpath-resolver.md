---
"@hasna/instructions": patch
---

The MCP server's `check_all` status reports `db_path` through the @hasna/paths resolver (`getReportedDbPath`) instead of a hardcoded legacy `~/.hasna/instructions/instructions.db` literal — the reported store path now tracks the effective store home once the XDG config home is adopted (`HASNA_CONFIG_HOME` set or the store migrated to `~/.config/hasna/configs` on Linux). The exact `HASNA_INSTRUCTIONS_DB_PATH` override still wins. Complements the #1291 configs store-root resolver switch; dependency remains exactly pinned to `@hasna/paths@0.1.0`. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)
