# Security Policy

## Reporting

Report security issues privately to the maintainers before opening public issues.

Do not include API keys, TOTP seeds, backup codes, recovery codes, passwords, session cookies, or live OTP codes in reports, logs, screenshots, or chat messages. Redact values and include only metadata needed to reproduce the issue.

## Secret Handling

TOTP seeds are credentials.

`open-otp` stores seeds encrypted at rest in `~/.hasna/otp/entries.json` and stores local key material in `~/.hasna/otp/vault.key`. Both files are created with owner-only permissions. Normal CLI and MCP surfaces return labels and generated codes only, never seed values.

This local encryption model does not protect against a compromised OS user account that can read both the encrypted store and local key. Use full-disk encryption, keep backups encrypted, and restrict access to the user account running agents.

## Supported Versions

Only the latest published version receives fixes.
