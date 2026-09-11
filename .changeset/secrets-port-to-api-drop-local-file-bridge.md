---
"@hasna/secrets": minor
---

Removed the `~/.secrets` env-file bridge and the vestigial `path` verb, and
`encrypt-vault` now reports a single service-verified outcome.

- `export-env` is gone. It wrote hosted secret **values** as plaintext `.env`
  files under `~/.secrets/`; `secrets exec <key> --as VAR -- <command>` is the
  supported way to hand a value to a consumer without ever writing it down.
- `import-env` is gone with it — it was the one-time migration aid that read
  those same plaintext files back into the vault.
- `path` is gone. It printed "where is the vault", which on the hosted client
  is just the API URL that `secrets status` already reports (with the
  credential source, redacted).
- `encrypt-vault` prints the service's verified repair result only. It calls
  `POST /v1/encryption/repair` and no longer has a second, locally worded
  outcome that omits the server's verification.
