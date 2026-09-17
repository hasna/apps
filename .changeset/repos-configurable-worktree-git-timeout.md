---
"@hasna/repos": patch
---

Raise the worktree-plane Git process timeout from 30 seconds to a bounded 10-minute default, add the documented `HASNA_REPOS_GIT_TIMEOUT_MS` override with the legacy `REPOS_GIT_TIMEOUT_MS` alias, and reject non-integer or over-30-minute values rather than passing unsafe timeout values to the runtime.
