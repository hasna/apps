---
"@hasna/recordings": minor
---

Keep the local SQLite engine out of the Recordings CLI, MCP, and SDK client bundles.

The explicit `HASNA_RECORDINGS_LOCAL=1` lane is still shipped, but its implementation
is reached only through a gated dynamic import and emitted under `dist/chunks/`. Hosted
clients continue to resolve `https://api.hasna.com/recordings/v1`, re-resolve credentials
for every request, and fail closed without falling back to the on-box store. Existing
hosted save, export, paste-history, and audio surfaces are unchanged.
