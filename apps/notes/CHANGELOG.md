# @hasna/notes

## 0.1.1

### Patch Changes

- 603420e: macOS app rename + proper signing: the WKWebView shell builds as HasnaNotes.app (bundle id com.hasna.notes unchanged), signed with the fleet Developer ID identity "Developer ID Application: VASILE ANDREI HASNA (HKZ326A8Y3)" instead of ad-hoc. In-app UI strings, web UI branding, and the JS bridge global are renamed to HasnaNotes (window.PersonalNotes alias removed); the sidecar auth header is now X-Hasna-Notes-Token only. Build/deploy scripts renamed to scripts/build_notes.sh and scripts/deploy_notes.sh; deploy backs up and removes legacy installs that share the bundle id (bundle-id scan, no hardcoded legacy display names).
- 7c0cc88: First release under the new name: the app previously published as @hasna/personalnotes is renamed to @hasna/notes (apps/notes, HasnaNotes.app, bundle id com.hasna.notes). Renames the CLI/MCP/serve bins to notes/notes-mcp/notes-serve, moves env vars to HASNA*NOTES*\* (legacy names still honored for one release with a deprecation warning), migrates the config path to ~/.config/hasna-notes/config.json, and fixes the package contract (cli-with-store with the SQLite storage block). The sync wire dialect keeps the personalnotes/v1 name.
