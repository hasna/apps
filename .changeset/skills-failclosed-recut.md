---
"@hasna/skills": minor
---

Fail-closed re-cut (owner ruling 2026-09-07 / hasna/apps#1720). Supersedes the
`skills-allcmds` branch (#1898, closed) and lands beside #2166, which ports
`skills feedback` to the hosted API.

- `@hasna/skills/sdk` no longer opens SQLite: `SqliteGovernanceStore`,
  `createGovernanceStore` and `SqliteRunExecutionStore` moved to the server side
  (`src/server/sqlite-governance-store.ts`, `src/server/sqlite-run-execution-store.ts`,
  reached by `skills-serve` only). The SDK keeps the `GovernanceStore` /
  `RunExecutionStore` interfaces, the in-memory stores and the Postgres
  governance store.
- This package writes no credential file any more. Credential provisioning is a
  separate, owner-authorised step: `skills auth login` / `auth signup` request the
  one-time code and name where the key belongs; `auth login --api-key` verifies
  only (`status: "verified"`, `stored: false`); device login and workspace
  enrollment (`auth login --membership-id`) refuse before any request; `auth logout`
  reports the credential's source instead of editing a file; `skills setup --api-url`
  and `skills config unset apiUrl` validate/report and never touch
  `~/.hasna/skills/config/credentials`. Every refusal carries the stable code
  `CREDENTIAL_STORE_UNMANAGED` and names the Keychain item
  (`hasna.credentials.skills.api-key`), the credentials-file line
  (`HASNA_SKILLS_API_KEY=`) and the environment variable — never a value.
- Operator URLs in the fleet `/v1` dialect normalize like `/api/v1` bases and
  bare origins (carried from #1898).
