---
"@hasna/projects": minor
---

Resolve credentials through the `@hasna/contracts` client resolver
(hasna/apps#1720, #1668, #1690, #1613, #1599).

- `@hasna/contracts` is pinned to `1.0.1`, and the vendored server storage kit
  is regenerated at that version.
- The CLI, the MCP server and the `./sdk` export now share ONE credential and
  authority resolution — the contracts client seam — recomputed on every call.
  Precedence: an explicit argument → a deliberate env pointer
  (`HASNA_PROJECTS_API_KEY_OVERRIDE`, `HASNA_PROFILE`,
  `HASNA_PROJECTS_API_KEY_REF`) → the macOS Keychain item
  `hasna.credentials.projects.api-key` (account `HASNA_STATION`, else
  `hostname -s`, else `USER`) → `~/.hasna/projects/config/credentials`
  (0400/0600, read at call time, `HASNA_HOME`/`HASNA_CONFIG_HOME` overrides,
  XDG never) → `HASNA_PROJECTS_API_KEY` in the process environment, which is a
  legitimate tier and prints no notice.
- The service URL follows the same ladder (`HASNA_PROJECTS_API_URL`, the
  Keychain `api-url` item, the credentials file) and defaults to the
  path-prefixed fleet gateway `https://api.hasna.com/projects`; the client
  appends `/v1`. A key alone is now enough to reach the fleet — URLs never need
  configuring.
- `createProjectsClientFromEnv()` no longer reads `PROJECTS_API_URL` /
  `PROJECTS_API_KEY` itself. Those unprefixed names remain accepted by the seam
  as a documented alias for one release; the canonical `HASNA_PROJECTS_*` names
  always work and win. The SDK completes a `HASNA_PROJECTS_API_KEY_REF` vault
  pointer per request, and throws instead of building an unauthenticated client.
- **Breaking for local runs:** `HASNA_PROJECTS_LOCAL_REGISTRY` is removed.
  Routing is on URL + key only. An authority declared anywhere with no
  resolvable credential fails LOUD (non-zero exit, no local SQLite store opened,
  no local-fallback event); the on-box registry is reached only when NOTHING
  configures the fleet, and that unhosted OSS mode prints one line on stderr
  saying so and naming the database it opened.
- `projects-serve`'s Contacts authority uses the same rule: a completely silent
  environment yields no authority, anything half-configured throws. Server-side
  API-key verification is unchanged.
