---
"@hasna/machines": patch
---

`machines flip` now registers `emails` so the hosted-mailbox route rolls fleet-wide with every other app; `mailery` is removed from the registry (retired upstream, never a client flips host). Emails is the first app with a per-app profile override: it writes `EMAILS_SELF_HOSTED_URL` + `EMAILS_CLIENT_ENV_SECRET` (a Vault pointer the emails CLI resolves itself) instead of the generic `HASNA_EMAILS_API_URL`/`API_KEY`, so no literal key is materialised on disk, and its status verifier reads `mode.current` from `emails status --json`.
