---
"@hasna/domains": minor
---

Resolve credentials through the `@hasna/contracts` 1.0.2 client chain
(hasna/apps#1720).

The CLI, the MCP server and the `./sdk` client no longer carry a credential
chain of their own. All three call the one resolver in `@hasna/contracts`
(pinned to 1.0.2), which reads, per call: an explicit `--api-key`/`--profile`,
then `HASNA_DOMAINS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
`HASNA_DOMAINS_API_KEY_REF`, then the macOS Keychain item
`hasna.credentials.domains.api-key`, then `~/.hasna/domains/config/credentials`
(owner-only 0400/0600), then `HASNA_DOMAINS_API_KEY`. The authority follows the
same ladder — `HASNA_DOMAINS_API_URL`, the Keychain `api-url` item, the
credentials file — and now DEFAULTS to the fleet gateway
`https://api.hasna.com/domains` once a credential resolves, so a key alone is a
complete configuration. Resolving per call is what makes a key rotation heal a
long-lived shell, MCP server or agent without restarting it: the store's
authenticated transport and the SDK re-resolve the credential on every request,
so the next request after a rotation carries the new key. The two deliberate
exceptions are an explicit `apiKey` argument (tier 1, a pin the caller owns)
and the service authority, which is fixed for the life of a client so a
credential written for one authority is never sent to another.

What this removes (the app's own chain, class B):

- The app's own client flip (`resolveClientFlip`), its test-run downgrade guard
  and its escape hatches (`HASNA_DOMAINS_ALLOW_CLOUD_IN_TESTS`,
  `HASNA_DOMAINS_TEST_GUARD`, `HASNA_DOMAINS_ALLOW_CLOUD_WITH_LOCAL_PATH`) —
  the shared resolver's env contract decides, and a local path set NEXT TO a
  configured authority/credential is a loud conflict in every runner.
- The in-package reimplementation of the deleted `@hasna/paths` resolver, the
  XDG data/config home layout, `~/.config/hasna`, `$XDG_CONFIG_HOME`,
  `$XDG_DATA_HOME` and the one-time migrations from the pre-XDG layout. The
  local data home is `~/.hasna/domains` (or `$HASNA_HOME/domains`), exactly
  where the resolver's credential file lives.
- The retired `*_MODE` / `*_STORAGE_MODE` switches, everywhere. Nothing in the
  package mentions them.
- The unprefixed names no longer outrank the canonical pair: the app never
  reads `DOMAINS_API_URL` / `DOMAINS_API_KEY` itself, the resolver's
  silent-alias fallback is the only place they are accepted (one release), and
  the canonical `HASNA_DOMAINS_*` path names (DB path, dir, home, config path)
  always win over their legacy aliases.

What this adds:

- `getStoreResolution()` on the package entry and a transport report in
  `domains doctor`: which store resolved, WHERE the URL and key came from
  (env key NAME, Keychain reference, file PATH, or `"default"`), and WHICH tier
  supplied the key — never the key value.
- Local mode is an explicit opt-in (a local path var, with no authority or
  credential configured in the environment) and every local run prints one
  `LOCAL mode` line on stderr.
- `createDomainsClientFromEnv()` (`./sdk`) now accepts `profile` and `keychain`
  options, and a client built with an EXPLICIT `baseUrl` and no `apiKey` never
  attaches an ambient fleet key resolved against another authority
  (hasna/apps#1794).

Behaviour worth knowing about:

- Hosted mode with no credential still fails closed — non-zero exit, no SQLite
  fallback, no local-fallback event — and the message now names every tier it
  consulted, so the remedy is in the error.
- `@hasna/contracts` moved to a devDependency: `bun build --target bun` inlines
  it into every shipped bundle, and the published `.d.ts` files are
  self-contained (they spell the crossing client types locally;
  hasna/apps#1782), so consumers install nothing extra.
- A credential with no URL used to be refused as a half-configured pair; it now
  resolves the fleet gateway.
- A declared-but-blank authority variable no longer disables the Keychain
  tier: removing a blank means handing the resolver a COPY of the environment,
  and `@hasna/contracts` gates its ambient tiers on object identity, so the
  gate is decided before normalising and carried across as `keychain.enabled`
  (hasna/apps#1788).