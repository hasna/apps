---
"@hasna/files": minor
---

Resolve credentials through the `@hasna/contracts` client chain (hasna/apps#1720).

The CLI, the MCP server and the `./sdk` client no longer carry a credential
chain of their own. All three call the one resolver in `@hasna/contracts`
(pinned to 1.0.2), which reads, per call: an explicit `--api-key`/`--profile`,
then `HASNA_FILES_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
`HASNA_FILES_API_KEY_REF`, then the macOS Keychain item
`hasna.credentials.files.api-key`, then `~/.hasna/files/config/credentials`
(owner-only 0400/0600), then `HASNA_FILES_API_KEY`. The authority follows the
same ladder — `HASNA_FILES_API_URL`, the Keychain `api-url` item, the
credentials file — and now DEFAULTS to the fleet gateway
`https://api.hasna.com/files` once a credential resolves, so a key alone is a
complete configuration. The `./sdk` no longer needs a private env read either:
`createFilesClientFromEnv` builds a client through the same chain, resolving
the credential fresh on EVERY request, so a client held for hours picks up a
key rotation without being rebuilt. The unprefixed `FILES_API_URL` /
`FILES_API_KEY` names survive only as a silent resolver alias for one release;
the canonical `HASNA_FILES_*` names always win.

What this removes:

- The home-grown transport selection (`HASNA_FILES_API_URL` +
  `HASNA_FILES_API_KEY` pair checks, alias precedence, half-configured-pair
  refusals) that `resolveFilesCloudStorage` layered on top of the resolver,
  together with the store's process-lifetime memoization — the store now
  resolves fresh per call, so a long-lived MCP server or agent loop picks up a
  rotation without a restart.
- The `HASNA_FILES_LOCAL_MODE` / `FILES_LOCAL_MODE` switches. The on-box
  SQLite store is reachable only through the explicit opt-in
  `HASNA_FILES_LOCAL=1` (alias `FILES_LOCAL=1`), and every local run now
  prints one `files: LOCAL mode — ...` line on stderr so an unhosted run is
  never mistaken for an empty hosted one. `*_STORAGE_MODE` was already read
  nowhere and is gone from the tests.
- The retired paths, which the resolver no longer consults either:
  `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna` and
  `$XDG_CONFIG_HOME`. No `~/.files/config.json` key store was ever read.
- The legacy-env DEPRECATED stderr notice, which @hasna/contracts 1.0.2
  drops: `HASNA_FILES_API_KEY` is a legitimate tier, it just sits below disk.

What this adds:

- `@hasna/files/sdk` exports `createFilesClientFromEnv`, `FILES_APP_NAME` and
  `resolveFilesSdkTransport` (the transport report: which tier and source
  supplied the credential, never the value). An explicit `baseUrl` with an
  `apiKey` is a deliberate caller-owned pin; a `baseUrl` with NO `apiKey`
  never receives the ambient fleet key (hasna/apps#1794).
- `src/store/client-types.ts` keeps the published `.d.ts` free of
  `@hasna/contracts` imports (#1782): crossing shapes are spelled locally and
  pinned to the real declarations, in both directions, by
  `src/store/client-types.test.ts`.
- Hermetic credential tests (fake `HOME`/`HASNA_HOME`, injected `security`
  runner): env tier, disk tier, Keychain tier, per-request rotation
  freshness, fail-closed, and the transport report.

Behaviour worth knowing about:

- Hosted mode with no credential still fails closed — non-zero exit, no
  SQLite fallback, no local-fallback event — and the message now names every
  tier the resolver consulted, so the remedy is in the error. The `./sdk`
  factory throws in that case too.
- A credential with no URL used to be refused as a half-configured pair; it
  now resolves the fleet gateway. A declared-but-blank `*FILES_*` variable is
  normalised to absent at the files seam (helpers in the wild blank rather
  than delete), and the Keychain tier's ambient gate is carried across that
  normalisation as `keychain.enabled`, so a station with a Keychain item is
  never silently dropped to the disk tier (hasna/apps#1788).