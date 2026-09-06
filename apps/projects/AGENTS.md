# AGENTS.md — @hasna/projects

Guidance for coding agents working with the Projects CLI, MCP server, SDK, and
`projects-serve` backend. The Projects app follows the fleet-wide credential
resolver ruling (owner directive 2026-09-04, hasna/apps#1720): every surface
resolves its API key and URL through the one `@hasna/contracts` client seam.

## Credential routing — one seam, three outcomes

`resolveProjectStore()` (CLI and MCP server) and `createProjectsClientFromEnv()`
(./sdk) resolve through the shared resolver, fresh on every call. There is no
mode switch and no `*_STORAGE_MODE`; the retired locations
(`~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`) are never inputs.

| Outcome | When | What happens |
| --- | --- | --- |
| **Hosted** | a credential resolves from any tier (argument → env pointer → macOS Keychain `hasna.credentials.projects.api-key` → `~/.hasna/projects/config/credentials` 0400/0600 → `HASNA_PROJECTS_API_KEY`) | registry commands go to `<authority>/v1`, defaulting to `https://api.hasna.com/projects` |
| **Fail closed** | an authority is declared but no credential resolves — or NOTHING configures the fleet and there is no opt-in | non-zero exit, error naming every tier looked at, no SQLite opened, no local-fallback event |
| **Local (opt-in only)** | `HASNA_PROJECTS_LOCAL=1` (alias `PROJECTS_LOCAL`) with no env-declared authority or credential | on-box SQLite registry (`HASNA_PROJECTS_DB_PATH`, else `~/.hasna/projects/projects.db`); prints one line saying it is local on stderr |

The opt-in is answered BEFORE the resolver runs, so an opt-in run never touches
the Keychain or a credentials file; any env-declared authority or credential
outranks it, and a half-configured opt-in run (URL set, no key) still fails
loud. Never "fix" a missing credential by serving the local registry silently —
that is the fail-closed bug this ruling closes.

## SDK

```typescript
import { createProjectsClientFromEnv } from "@hasna/projects/sdk";

const client = createProjectsClientFromEnv(); // resolves per call: Keychain → credentials file → env
await client.listProjects();
```

The SDK never falls back to an unauthenticated client or to local data: no
resolvable credential throws. An explicit `baseUrl` with no `apiKey` does not
attach the ambient fleet key — the `x-api-key` header is only sent when a
credential resolved for that authority.

## The hosted backend

`projects-serve` runs the hosted API against PostgreSQL and requires
`HASNA_PROJECTS_DATABASE_URL` (or `PROJECTS_DATABASE_URL` / `DATABASE_URL`),
failing fast without it. API keys are verified per request and scoped
(`projects:read` for reads, `projects:write` for writes). See
`docs/hosted-backend-readiness-contract.md`.

## Test discipline

Tests are hermetic: fake `HOME`/`HASNA_HOME`, a Keychain account with no items
(`HASNA_STATION=hasna-projects-tests-no-keychain`), and — for local-registry
runs — the explicit `HASNA_PROJECTS_LOCAL=1` opt-in via
`src/testing/spawn-env.ts`. Never point a test at a real credential.