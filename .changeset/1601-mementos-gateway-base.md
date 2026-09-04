---
"@hasna/mementos": patch
---

The SDK client survives a path-prefixed gateway base URL (hasna/apps#1601).

`MementosClient` now resolves its base once: the configured path prefix is kept
(`https://api.hasna.com/mementos` → `https://api.hasna.com/mementos/v1/...`,
never rebuilt from `URL.origin`), and a base that already carries `/v1` or the
legacy `/api` is not versioned a second time into `/mementos/v1/v1/memories`.
`MementosClient.fromEnv` reads the canonical `HASNA_MEMENTOS_API_URL` /
`HASNA_MEMENTOS_API_KEY` pair first, keeping `MEMENTOS_API_URL` / `MEMENTOS_URL`
/ `MEMENTOS_API_KEY` as fallbacks, and ignores blank values. The resolved `/v1`
root is exposed as `client.apiUrl` for the uniform `API:` status line
(hasna/apps#1588).
