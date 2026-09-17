---
"@hasna/files": minor
---

Resolve the app home to `~/.hasna/files` on every platform, per the 2026-09-04
home-layout ruling.

`apps/files` carried a private fork of the deleted `@hasna/paths`
(hasna/apps#1535) in `src/lib/paths.ts` and again in `scripts/ensure-data-dir.mjs`.
It resolved an XDG / macOS layout — `~/.local/share/hasna/files` on Linux,
`~/Library/Application Support/Hasna/files` on macOS — labelled `~/.hasna/files`
"legacy (pre-XDG)", and preferred the XDG root over it. The ruling makes
`~/.hasna/<app>` the only canonical home, so the fork is removed.

The silent adoption rule is removed with it. The data root used to switch to the
XDG path merely because a `files.db` already existed there, which relocated a
station's home with no operator intent and let a local SQLite artefact select
live behaviour. Local SQLite remains supported only under the explicit
`HASNA_FILES_LOCAL=1` opt-in; its mere presence never selects the transport or
home.

Overrides are unchanged in spirit and now the only way the home moves:
`HASNA_FILES_DATA_DIR` / `FILES_DATA_DIR` / `HASNA_FILES_HOME` / `FILES_HOME`
name the data root directly when absolute; `HASNA_DATA_HOME` relocates it to
`<HASNA_DATA_HOME>/files`; `HASNA_HOME` relocates the `~/.hasna` root.
`HASNA_CONFIG_HOME`, `HASNA_STATE_HOME` and `HASNA_CACHE_HOME` never move the
data root. Relative or whitespace home/data-root overrides are treated as unset
rather than resolved against the working directory.

The postinstall script no longer creates an XDG directory at install time.
Runtime and postinstall root selection are covered by one parity matrix.

**Upgrade note.** A station that had adopted the XDG root implicitly — data at
`~/.local/share/hasna/files` or `~/Library/Application Support/Hasna/files` with
`HASNA_DATA_HOME` unset — will now resolve `~/.hasna/files` instead. Nothing is
moved or deleted. If the canonical database is absent, explicit local startup
refuses with `FILES_STRANDED_XDG_DATA` rather than creating an empty database
beside the old one. Stop Files processes and back up both roots, then either set
`HASNA_FILES_DATA_DIR` to the retained root or perform an offline migration that
preserves the database, WAL/SHM state, configuration, and other root contents.
Explicitly selected data roots remain authoritative and are not silently
redirected by unrelated retired data.
