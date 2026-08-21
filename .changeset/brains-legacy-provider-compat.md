---
"@hasna/brains": patch
---

Add legacy provider compatibility for the tinker rename: the pre-0.0.36 `thinker-labs` provider value and `THINKER_LABS_API_KEY` / `THINKER_LABS_BASE_URL` env vars are accepted and normalized to `tinker` / `TINKER_*` at the CLI, MCP, and schema boundaries, so existing 0.0.35 configurations and persisted rows keep working. Also document the full 0.0.36 change set in the changelog (provider rename, read-after-write fix, storage-mode removal, display name, prepack build).
