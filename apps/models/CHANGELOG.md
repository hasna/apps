# Changelog

## Unreleased

### Changed

- Run install, typecheck, build, and tests in GitHub Actions for pull requests and pushes to `main`.

## 0.0.9

### Changed

- Switch @hasna/models local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/models` default (with the `HASNA_MODELS_HOME`, `HASNA_MODELS_DB`, `HASNA_MODELS_CACHE`, and `HASNA_MODELS_INSTALLS` exact-app overrides) stays the effective data home until the store is actually migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)

## 0.0.8

### Security

- Harden Hugging Face download path safety in `createDownloadPlan` / `downloadPlannedFiles`:
  - reject remote file paths containing NUL, backslashes, drive letters, absolute
    paths, and `.`/`..`/empty segments;
  - reject multiple remote files that resolve to the same destination;
  - reject install roots (and their ancestors) that are or contain symlinks, and
    re-validate the root and parent directories after each fetch to close TOCTOU
    symlink-swap races;
  - always fetch from a recomputed trusted Hugging Face URL derived from the ref
    instead of trusting the plan's `downloadUrl`, preventing token exfiltration to
    an attacker-controlled URL.
- `safePathSegment` now maps `.` and `..` to `unnamed` so path segments can never
  become dot-directory aliases.
