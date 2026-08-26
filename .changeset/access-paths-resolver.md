---
"@hasna/access": patch
---

Switch @hasna/access local path reads/writes to the @hasna/paths resolver (XDG/macOS home layout): the SQLite store, backups, config, exports, logs, and tmp dirs now resolve through @hasna/paths instead of the hardcoded `~/.hasna/access` root, honoring `HASNA_*_HOME` overrides. Nothing is moved on disk in this phase — the package can now resolve the new paths (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
