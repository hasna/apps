---
"@hasna/instructions": patch
---

The MCP server's `check_all` status reports `db_path` through the in-package resolver (`getReportedDbPath`) instead of a hardcoded legacy `~/.hasna/instructions/instructions.db` literal — the reported store path now tracks the effective store home once the XDG config home is adopted (`HASNA_CONFIG_HOME` set or the store migrated to `~/.config/hasna/configs` on Linux). The exact `HASNA_INSTRUCTIONS_DB_PATH` override still wins. Complements the #1291 configs store-root resolver switch; the wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
