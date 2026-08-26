---
"@hasna/shield": patch
"@hasna/shield-sdk": patch
---

Security: shield-serve now guards every `/api` route — when `SECURITY_API_KEY` is set, requests must present it (`x-api-key` or `Authorization: Bearer`, timing-safe). The server binds `127.0.0.1` by default; a non-loopback `--host` bind without `SECURITY_API_KEY` is refused at startup. `POST /api/scans` scans only under `SECURITY_SCAN_ROOTS` (comma-separated absolute paths, default `$HOME`) and gates host-wide `include_system` behind `SECURITY_ALLOW_SYSTEM_SCANS=1`. The SDK client takes an optional API key as its second constructor argument; the dashboard sends the key entered in its header field.
