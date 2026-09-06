---
"@hasna/shortlinks": minor
---

Adopt the @hasna/contracts 1.0.2 client credential resolver for every hosted
surface (CLI, MCP server, and `./sdk`) (hasna/apps#1720).

- `@hasna/contracts` is pinned to exact `1.0.2` (still build-time: `bun build
  --target bun` inlines it, so consumers install nothing extra). The published
  `.d.ts` no longer imports `@hasna/contracts`: crossing types are spelled
  locally in `src/client-types.ts` and asserted against the real contracts
  declarations at compile time (hasna/apps#1782).
- The app's own env chain is deleted. The resolver decides: the Keychain item
  `hasna.credentials.shortlinks.api-key` (macOS), the disk credential
  `~/.hasna/shortlinks/config/credentials` (0400/0600), or
  `HASNA_SHORTLINKS_API_KEY` (legacy alias `SHORTLINKS_API_KEY`), with the
  authority following `HASNA_SHORTLINKS_API_URL` or defaulting to the fleet
  gateway `https://api.hasna.com/shortlinks` — URLs never need configuring. A
  credential alone (any tier) selects the hosted `/v1` API, resolved fresh per
  request.
- Fail-closed semantics (owner ruling 2026-09-04): hosted with no credential
  exits non-zero, creates no SQLite, and never emits a `*-local-fallback`
  event. Local mode is reachable ONLY by explicit opt-in
  (`HASNA_SHORTLINKS_LOCAL=1`, alias `SHORTLINKS_LOCAL`, or `--db <path>`) and
  announces "local" on stderr. A URL without a credential, a declared-but-blank
  variable, disagreeing authorities, or an unreadable credential file all
  throw.
- Never hands @hasna/contracts a copied env object (hasna/apps#1788):
  declared-but-blank authority variables are normalised at the app seam, with
  the Keychain tier's ambient gate carried across the copy when one is forced.
- SDK (#1794): an explicit `baseUrl` with no `apiKey` never attaches the
  ambient fleet key — the credential is pinned to the authority it resolved
  with. `createShortlinksApiClient` refreshes the credential on every request.
- New hermetic tests (fake HOME/HASNA_HOME, injected `security` runner):
  credential resolution (env/disk/keychain/argument tiers), fail-closed
  guarantees, and the transport report.