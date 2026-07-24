# Changelog

## 0.1.1 — 2026-07-24

PR-drain finalization (all open PRs merged; 0 remaining). No shipped-source
(`src/`) changes since 0.1.0 — the artifact is functionally identical; this
release marks npm `latest` to current `main` after the drain.

- test: expand crypto/totp/otpauth/storage coverage to ~100% (#2)
- docs: expand threat model and security boundaries (#4)
- docs: LOC scan report — zero files over 1000 LOC (#3)
- feat(ci): unified check script + GitHub Actions CI (#1)

## 0.1.0

- Initial release: local encrypted OTP/TOTP manager for AI agent workflows
  (CLI + MCP server).
