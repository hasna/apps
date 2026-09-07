---
"@hasna/telephony": minor
---

Resolve credentials through the `@hasna/contracts` 1.0.2 client chain
(hasna/apps#1720, class B).

The CLI, the MCP server and the `./sdk` client no longer carry a credential
chain of their own. All three call the one resolver in `@hasna/contracts`
(pinned to 1.0.2), which reads, per call: the deliberate pointers
(`HASNA_TELEPHONY_API_KEY_OVERRIDE`, `HASNA_PROFILE`,
`HASNA_TELEPHONY_API_KEY_REF`), then the macOS Keychain item
`hasna.credentials.telephony.api-key`, then
`~/.hasna/telephony/config/credentials` (owner-only 0400/0600), then
`HASNA_TELEPHONY_API_KEY`. The authority follows the same ladder —
`HASNA_TELEPHONY_API_URL`, the Keychain `api-url` item, the credentials file —
and now DEFAULTS to the fleet gateway `https://api.hasna.com/telephony` once a
credential resolves, so a key alone is a complete configuration. The hosted
transport re-resolves the credential on every request, so a key rotation heals
a long-lived shell, MCP server or agent without restarting it; the service
authority is pinned for the life of the client, so a credential written for
one authority is never sent to another.

What this removes:

- The app's own env chain and its hand-rolled resolution: the direct
  `HASNA_TELEPHONY_API_URL` / `HASNA_TELEPHONY_API_KEY` reads, the partial-pair
  rejection, the `resolveStorageClient` hand-off that only the env pair could
  reach, and `src/lib/retired-storage-mode.ts` with the `*_MODE` /
  `*_STORAGE_MODE` rejections and their DEPRECATED notice. Nothing reads
  `~/.hasna/fleet-env`, the shared-cloud dirs, `~/.config/hasna`,
  `$XDG_CONFIG_HOME` or a `~/.telephony/config.json` key store.
- A URL-without-key used to be refused as a half-configured pair; it now fails
  loud as a configured authority with no resolvable credential, naming every
  tier consulted. A key-without-URL used to be refused too; it now resolves
  the fleet gateway.

What this adds:

- `src/lib/client-transport.ts` — the thin adapter over the shared resolver,
  plus `resolveTelephonyClientTransport` and a source-names-only transport
  report (`mode`, `transportSource`, `baseUrl`, `apiUrlSource`,
  `apiKeySource`, `apiKeyTier`, `credentialFileCandidates`,
  `keychainTierEnabled`, `warning`) so a diagnostic can say WHICH tier decided
  without ever exposing a value.
- `telephonyResolverInputs` — the declared-but-blank normalisation that keeps
  "blank means unset" true at the telephony seam without disabling the
  Keychain tier (hasna/apps#1788): removing a blank means handing the resolver
  a COPY, and @hasna/contracts gates its ambient tiers on object identity, so
  the gate is decided before normalising and carried across as
  `keychain.enabled`.
- The manifest's `kitVersion` moved with the pin to 1.0.2 and the vendored
  storage kit was regenerated from it: the server backend is PostgreSQL-only
  and fails closed without `HASNA_TELEPHONY_DATABASE_URL`; retired
  storage-mode variables are inert and never select anything.

Behaviour worth knowing about:

- Hosted mode with no credential still fails closed — non-zero exit, no SQLite
  fallback, no local-fallback event — and the message names every tier it
  consulted.
- Local mode (`HASNA_TELEPHONY_LOCAL=1`, alias `TELEPHONY_LOCAL=1`) keeps its
  explicit opt-in semantics but YIELDS to any resolved credential: a Keychain
  item, a credentials file, or `HASNA_TELEPHONY_API_KEY` all outrank it and
  select the hosted API (secrets pattern). With nothing resolving anywhere,
  the opted-in run serves the on-box SQLite store and prints one `local` line
  on stderr — local is never a silent state.
- A declared-but-blank `*TELEPHONY_*` credential variable no longer refuses a
  complete configuration that sits beside it: blanks are normalised to
  "unset" at the telephony seam.