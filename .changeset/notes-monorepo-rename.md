---
"@hasna/notes": patch
---

First release under the new name: the app previously published as @hasna/personalnotes is renamed to @hasna/notes (apps/notes, HasnaNotes.app, bundle id com.hasna.notes). Renames the CLI/MCP/serve bins to notes/notes-mcp/notes-serve, moves env vars to HASNA_NOTES_* (legacy names still honored for one release with a deprecation warning), migrates the config path to ~/.config/hasna-notes/config.json, and fixes the package contract (cli-with-store with the SQLite storage block). The sync wire dialect keeps the personalnotes/v1 name.
