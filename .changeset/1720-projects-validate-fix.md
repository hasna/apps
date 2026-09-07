---
"@hasna/projects": patch
---

Resolver validation fixes (hasna/apps#1720).

- **`./sdk` never attaches the ambient fleet key to a caller-supplied `baseUrl`
  (#1794).** `createProjectsClientFromEnv(env, { baseUrl })` is a deliberate
  pin of the authority: it now requires an explicit `apiKey` and the
  @hasna/contracts chain (Keychain, credentials file, `HASNA_PROJECTS_API_KEY`)
  is never consulted on its behalf. With `baseUrl` + `apiKey` the pair is used
  verbatim; with `baseUrl` alone it throws `PROJECTS_SDK_AUTHORITY_PIN_MESSAGE`
  before reading any tier. Previously a station's Keychain credential was sent
  to whatever server the caller named.
- **A hosted `projects doctor` / MCP `projects_doctor` / prompt-agent doctor
  never opens or creates the on-box SQLite (acceptance f).** The reference,
  agent-run and migration-map checks were reaching `getDatabase()` on the
  hosted transport, creating `projects.db(-wal/-shm)` under the app home on a
  READ. `doctorWorkspaceWithStore(store, project, options)` (exported from the
  package root as `doctorProjectWithStore`) now resolves the root/recipe
  references through the Store (`/v1/roots`, `/v1/recipes`) and the CLI, MCP
  server and prompt agent all route through it; the on-box-only checks report
  `WORKSPACE_AGENT_RUNS_LOCAL_ONLY` / `WORKSPACE_MIGRATION_MAP_LOCAL_ONLY`
  (warn) instead of a false OK read from an empty local ledger. A direct hosted
  `doctorWorkspace()` call without resolved references reports
  `WORKSPACE_ROOT_NOT_CHECKED` / `WORKSPACE_RECIPE_NOT_CHECKED` rather than
  touching disk. The local transport is unchanged.
- **`projects-mcp` fails closed at startup (acceptance c).** With no credential
  resolvable from any tier and no `HASNA_PROJECTS_LOCAL=1` opt-in, the server
  now exits non-zero naming where the credential should live BEFORE the stdio
  or HTTP transport starts — it no longer answers `initialize` and
  `tools/list` and defers the refusal to the first tool call. The explicit
  local opt-in prints its one "local mode" line at startup.
- The `HASNA_<TODOS|MEMENTOS|CONVERSATIONS>_DB_PATH` project-registration
  authority branch, which opens another app's on-box SQLite from a projects
  run, now announces itself with one `projects: local mode — …` line on
  stderr instead of doing so silently.
- `hasna.contract.json` states the hosted-by-default / fail-closed behaviour
  (the CLI and MCP surfaces are `api-key`-authenticated clients; the on-box
  registry is opt-in only) and `lib/client-configuration.ts` no longer claims
  `resolveProjectStore()` may fall to an unhosted mode.
