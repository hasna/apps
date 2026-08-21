---
"@hasna/brains": patch
---

Add legacy provider compatibility for the tinker rename. The pre-0.0.36 `thinker-labs` provider value and `THINKER_LABS_API_KEY` / `THINKER_LABS_BASE_URL` env vars are accepted and normalized to `tinker` / `TINKER_*` at the CLI, MCP, and schema boundaries; persisted rows that stored `thinker-labs` remain visible and updatable (`models list --provider tinker` matches both spellings, MCP status probes the legacy row id form, `models import` stores the canonical spelling). Canonical config always wins over the legacy spelling at any level. README carries the migration note; the 0.0.36 changelog entry documents the full change set (provider rename, read-after-write fix, storage-mode removal, terminology cleanup, prepack build).
