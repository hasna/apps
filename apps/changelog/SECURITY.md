# Security

Open Changelog stores local JSONL data in `~/.hasna/changelog` by default. Set `CHANGELOG_DATA_DIR` to use a project-specific or ephemeral data directory.

The package redacts obvious secret-shaped values from submitted text and metadata before writing entries. This is a best-effort safety layer, not a substitute for avoiding secrets in changelog text.

If `CHANGELOG_API_TOKEN` is configured, the HTTP API requires a bearer token or `x-changelog-token` header. API publish write mode is disabled unless `CHANGELOG_API_TOKEN` is configured and supplied. Do not expose the server on an untrusted network without token auth.

Publishing is dry-run by default. A target file is written only when `write: true` is supplied through the SDK/API/MCP tool or `--write` is supplied through the CLI.

Report security issues privately to Hasna maintainers before opening public issues.
