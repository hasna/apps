---
"@hasna/files": patch
---

Port the read-side MCP tools to the hosted /v1 transport: `download_file`, `get_file_content`, `extract_file_text`, `extract_file_snapshot`, `describe_file`, and `get_file_url` now route through the hosted routes in api mode (GET /v1/files/:id/content, POST /v1/files/:id/extract-text, plus a new POST /v1/files/:id/sign-download server route for server-signed download URLs). The 20 write/ingest/mechanism-local tools keep the on-box-only guard with a documented refusal in api mode; both halves are locked by behavior tests (task c4459d0c, local-only-capability triage wave 1).
