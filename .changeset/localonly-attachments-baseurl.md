---
"@hasna/attachments": patch
---

Port custom base URL server links (`--internal` / `base_url`) to the hosted `/v1` path. The server now accepts `base_url` on upload (JSON / multipart / query) and link-regenerate, validates it (absolute http(s), no embedded credentials, no query/fragment) and mints server-hosted share links against it instead of the configured public base URL. The CLI `--internal` flag and `UploadOptions.baseUrl` are no longer rejected in cloud client mode, and `RegenerateLinkOptions.baseUrl` is honored by both the local and hosted backends.
