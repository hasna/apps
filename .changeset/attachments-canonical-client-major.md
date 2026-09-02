---
"@hasna/attachments": major
---

Require explicit authenticated HTTPS for CLI, MCP, package-root and SDK clients,
and PostgreSQL plus object storage for the server. Retire local SQLite fallback,
client database/S3 credentials and legacy local-server exports. Preserve remote
uploads, downloads, encryption, presigned transfers, share links and integrations.
Legacy local data is left untouched; imports require a separate reviewed plan.

This breaking migration targets 2.0.0. Release remains gated on canonical shared
Contracts adoption, complete CI, independent review and final artifact verification.
