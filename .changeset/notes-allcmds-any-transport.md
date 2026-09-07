---
"@hasna/notes": patch
---

Every command works in any transport — the storage-mode axis is retired.

- Retired storage-mode selectors (`PERSONALNOTES_MODE`, `*_STORAGE_MODE`,
  `*_MODE`) are now INERT in the client and on the server: they select
  nothing, gate nothing, and no command is refused because one is set. The
  old fail-loud ratchet (`RetiredNotesStorageSelectorError`,
  `assertNoRetiredNotesStorageSelector`, the server selector train) is
  removed. The `@hasna/contracts` resolver already treats these variables as
  inert; the notes client and server now match it.
- The CLI no longer phrases command errors as transport-conditional
  ("on the canonical API"/"canonical HTTPS client" are gone). Pure Markdown
  helper commands (`markdown commands`, `markdown apply-command`) run offline
  before any transport resolution, so they work with zero configuration and
  in any environment.
- `notes-serve` honours the vendored storage kit's `NOTES_DATABASE_URL` DSN
  alias alongside required `HASNA_NOTES_DATABASE_URL` (conflicting values are
  refused) and no longer refuses startup because a retired server selector
  variable is present; the removed `--db` flag still fails loud.
- The vendored storage kit is regenerated to `@hasna/contracts` 1.0.2
  (KIT_VERSION 1.0.2, was 0.10.6): the server data backend is PostgreSQL-only
  and retired mode variables are inert in the generated code too.
- Tests: the removed-guard tests are replaced by hermetic inertness tests
  (transport report, HTTP store construction, server DSN resolution, CLI
  subprocess, bin runtime), and subprocess fixtures isolate `HOME` so the
  machine's ambient `~/.hasna/notes/config/credentials` cannot leak into
  tests.