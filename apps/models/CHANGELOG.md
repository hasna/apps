# Changelog

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
