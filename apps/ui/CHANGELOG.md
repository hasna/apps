# Changelog

## 0.0.6

- Make human-readable `ui list`, `ui events list`, and `ui webhooks list`
  output compact by default so agent terminals are not flooded with full
  records.
- Add progressive detail paths: `--limit`, `--cursor`, `--verbose`,
  `show`/`inspect` for a single record, and `--json` for full
  machine-readable output (bare `--json` list stays a complete array; explicit
  `--limit`/`--cursor` page the JSON).
- Redact sensitive event fields in human, verbose, replay, and JSON display
  even when stored events were persisted raw.

## 0.0.5

- Resolve the ui.sh content mirror from the current project directory (or
  `HASNA_UI_CONTENT_DIR`) instead of the package install directory, so globally
  installed packages can find a harvested mirror.
- `ui fetch` / `ui list` now fail with actionable setup guidance when no mirror
  is present, instead of silently returning an empty resource set.
- Add the `ui harvest [content-dir]` subcommand so installed packages can
  populate a local mirror.
- Reject unsafe/unsupported `uidotsh://` URIs (path traversal hardening),
  restricting resolution to `uidotsh://ui` and `uidotsh://ui/...`.

## 0.0.4

- Initial published release.
