---
"@hasna/notes": patch
---

macOS app notes live in the hosted path only (cloud-only storage, owner brief 2026-08-19, todos eca5b6da):

- The macOS app host (`Sources/HasnaNotesApp` NotesBridge) now reads and writes notes exclusively through the hosted notes API selected by `HASNA_NOTES_API_URL` + `HASNA_NOTES_API_KEY` (personalnotes/v1 dialect, via a Swift mirror of the client transport + a new `NotesHttpStore`). The on-disk `MarkdownStore` is no longer the app's store: an API URL without its key fails closed, and an unconfigured app shows a configuration banner instead of falling back to local note files.
- Bridge verbs map onto the wire dialect: trash is the soft-delete tombstone (`deletedAt`), archive maps to `archived`, restore is a PATCH on the tombstoned row, labels derive from the stored notes, and the trash-retention preference is a UserDefaults UI preference (the API has no settings surface; trash is never purged).
- Server: PATCH on a soft-deleted note now restores it (clears the delete tombstone and logs `note.restored`) — closes the GAP-2 "REST restore impossible" gap that made trash irreversible over HTTP.
- Transport resolution and the store verbs are regression-tested in the Swift smoke harness against a stub transport; the restore path is regression-tested in `server/server.test.mjs`.

Not breaking for existing self-hosted users: the CLI/MCP/server surfaces are unchanged; the change is app-host storage and one dialect behavior (PATCH on deleted rows previously 404'd).
