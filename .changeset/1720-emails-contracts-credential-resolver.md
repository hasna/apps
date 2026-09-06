---
"@hasna/emails": minor
---

Adopt the @hasna/contracts 1.0.2 credential resolver (hasna/apps#1720).

The hosted Emails client no longer owns a second credential chain. The API URL
and key now resolve through the shared `@hasna/contracts/client` resolver,
fresh on every request, from the same five tiers every hosted Hasna CLI uses:
`--api-key`/`--profile`, `HASNA_EMAILS_API_KEY_REF` pointers, the macOS
Keychain item `hasna.credentials.emails.api-key`, the
`~/.hasna/emails/config/credentials` file, then `HASNA_EMAILS_API_KEY`.

**Canonical env names** are now `HASNA_EMAILS_API_URL` / `HASNA_EMAILS_API_KEY`.
The legacy `EMAILS_SELF_HOSTED_URL` / `EMAILS_SELF_HOSTED_API_KEY` spellings
remain accepted as aliases for one release, one rung below the canonical names —
the same window skills gave its `SKILLS_API_*` names. A live user session
(`EMAILS_SESSION_TOKEN`) or agent identity token (`EMAILS_IDP_TOKEN`) still wins
as the bearer credential; the URL always comes from the resolver, defaulting to
the fleet gateway `https://api.hasna.com/emails` once a credential resolves.

**Deleted with the own chain**: the deployment-mode word
(`EMAILS_MODE` / `HASNA_EMAILS_MODE`) and all `*_STORAGE_MODE` switches, the
retired-mode refusal guards, and the `EMAILS_CLIENT_ENV_SECRET` vault-pointer
delivery of the URL and API key (the pointer now only persists the app's own
session/identity tokens). Hosted runs with no credential FAIL CLOSED — no
SQLite, no `local-fallback` event — and local SQLite is reached only by an
explicit `HASNA_EMAILS_DB_PATH` / `EMAILS_DB_PATH`, announced as
`emails: local mode` on stderr.