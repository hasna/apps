---
"@hasna/skills": minor
---

Resolve credentials through the shared `@hasna/contracts` client ladder
(hasna/apps#1720, #1668, #1690, #1613, #1599).

- The CLI, MCP server and `./sdk` export all resolve the credential through one
  seam (`lib/fleet-credentials.ts` → `@hasna/contracts/client`, pinned to 1.0.1):
  an explicit argument, then a deliberate env pointer
  (`HASNA_SKILLS_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_SKILLS_API_KEY_REF`),
  then the macOS Keychain item `hasna.credentials.skills.api-key`, then
  `~/.hasna/skills/config/credentials` (0400/0600, `HASNA_HOME` /
  `HASNA_CONFIG_HOME` overrides, XDG never), then `HASNA_SKILLS_API_KEY`.
  Resolved fresh on every call, so a rotated key is picked up without restarting
  a long-lived MCP server.
- The service address follows the same ladder — `HASNA_SKILLS_API_URL`, the
  Keychain `api-url` item, the credentials file — and defaults to the fleet
  gateway `https://api.hasna.com/skills` once a credential has resolved. The
  unprefixed `SKILLS_API_URL` / `SKILLS_API_KEY` spellings remain accepted as
  documented silent aliases for one release; `SKILL_API_KEY` (singular) is gone.
- **Fails closed.** An authority configured with no credential now exits
  non-zero with one line naming every tier that was consulted, instead of
  quietly answering from the bundled corpus. Local mode remains available when
  neither a credential nor a URL resolves — Skills ships its corpus — and prints
  one line saying so.
- `skills auth login` now writes `~/.hasna/skills/config/credentials` (the tier
  the whole fleet reads) with the display identity beside it in `identity.json`;
  `auth.json` in the data directory and `~/.skills/auth.json` are retired and no
  longer read. `skills auth whoami` reports which tier supplied the key, and
  `skills auth logout` says when a credential still resolves from elsewhere.
- `apiUrl` is retired as a config key: `skills setup --api-url <origin>` writes
  the credentials file instead (the address is per-user, so `--global` is
  accepted and ignored), and `skills config unset apiUrl` clears it.
