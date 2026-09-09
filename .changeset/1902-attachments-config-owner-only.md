---
"@hasna/attachments": patch
---

The attachments config file can now hold S3 access-key/secret values (`attachments config set --access-key/--secret-key`, MCP `configure_s3`), so `saveRawConfig` writes it owner-only: creation uses mode 0o600 and a pre-existing file an older release created umask-default (0644) is chmod'ed to 0o600 on the next save, matching the resolver's owner-only credential-tier rule (hasna/apps#1902).
