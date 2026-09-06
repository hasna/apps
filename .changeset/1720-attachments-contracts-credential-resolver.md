---
"@hasna/attachments": minor
---

Resolve credentials through the `@hasna/contracts` client chain (hasna/apps#1720).

The CLI, the MCP server and the `./sdk` client no longer carry a credential
chain of their own. All three call the one resolver in `@hasna/contracts`
(pinned exactly to 1.0.2), which reads, per call: an explicit
`--api-key`/`--profile`, then `HASNA_ATTACHMENTS_API_KEY_OVERRIDE` /
`HASNA_PROFILE` / `HASNA_ATTACHMENTS_API_KEY_REF`, then the macOS Keychain
item `hasna.credentials.attachments.api-key` (account `HASNA_STATION`, else
`hostname -s`, else `USER`), then `~/.hasna/attachments/config/credentials`
(owner-only 0400/0600), then `HASNA_ATTACHMENTS_API_KEY`. The authority
follows the same ladder — `HASNA_ATTACHMENTS_API_URL`, the Keychain `api-url`
item, the credentials file — and now DEFAULTS to the fleet gateway
`https://api.hasna.com/attachments` once a credential resolves, so a key
alone is a complete configuration. Resolving per call is what makes a key
rotation heal a long-lived MCP server or SDK client: every request
re-resolves, and the credential is pinned to the authority it resolved with —
an explicit SDK `baseUrl` with no `apiKey` never attaches the ambient fleet
key, and a changed authority refuses instead of sending the key elsewhere.

What this removes:

- The app's own env chain in `src/core/client-config.ts`: the hand-rolled
  pair/alias agreement check, the `*_MODE` / `*_STORAGE_MODE` switches, the
  client database-URL and DB_PATH rejections, and the DEPRECATED legacy
  notices. The resolvers read none of `~/.hasna/fleet-env`, `~/.hasna/cloud`,
  `~/.config/hasna`, `$XDG_CONFIG_HOME` or any `~/.attachments/config.json`
  key store. The unprefixed `ATTACHMENTS_*` spellings survive only as the
  shared resolver's silent alias fallback for one release, below the
  canonical names.
- `serviceConfig`/`withServiceAuth`'s private env reads for the Todos and
  Sessions integrations — they now resolve the `todos` / `sessions` chains
  through the same seam.

What this adds:

- `@hasna/attachments/sdk` exports `resolveAttachmentsSdkTransport` and
  `createAttachmentsApiClient`, so a consumer can see WHICH tier supplied its
  credential (never the value) and build the hosted `/v1` client without
  writing a private copy of the chain. The credential is refreshed inside the
  client on every request.
- `attachments doctor` / `status` / `whoami` report the credential source and
  tier that resolved; BLOCKED reports name the canonical env pair.
- A transport-report surface (`resolveAttachmentsTransport` in the package
  root) with source/tier reporting and failure messages naming every tier
  consulted.

Behaviour worth knowing about:

- Hosted mode with no credential still fails closed — non-zero exit, no
  SQLite fallback, no local-fallback event — and the message names every tier
  it consulted. A half-configured pair (URL without a key, blank or
  disagreeing aliases) is a hard error, never a silent local fallback.
- A declared-but-blank variable is a refusal, not an absence: the resolver
  throws rather than falling through to another identity.
- The serve app's API-key verifier moved to the strict 1.0.2 auth contract:
  `verifyApiKey` now takes the store's `keyStatus` hook (bare `isRevoked`
  cannot refuse keys the service has no record of), enforced at construction.
- `@hasna/contracts` moved from a runtime dependency to a devDependency —
  `bun build --target bun` inlines it into `dist`, and the published `.d.ts`
  files never import it (verified on the packed artifact by the release
  gate). The `repo-conformance` / `artifact-scan` tools are pinned to the
  same published 1.0.2.