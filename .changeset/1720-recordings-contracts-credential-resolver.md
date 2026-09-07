---
"@hasna/recordings": minor
---

Resolve credentials and the service authority through the `@hasna/contracts`
client chain (hasna/apps#1720, class B).

The CLI, the MCP server and the `./sdk` client no longer carry a credential
chain of their own. All three call the one resolver in `@hasna/contracts`
(pinned to 1.0.2), which reads, per call: an explicit `--api-key`/`--profile`,
then `HASNA_RECORDINGS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
`HASNA_RECORDINGS_API_KEY_REF`, then the macOS Keychain item
`hasna.credentials.recordings.api-key`, then
`~/.hasna/recordings/config/credentials` (owner-only 0400/0600), then
`HASNA_RECORDINGS_API_KEY`. The authority follows the same ladder —
`HASNA_RECORDINGS_API_URL`, the Keychain `api-url` item, the credentials file —
and now DEFAULTS to the fleet gateway `https://api.hasna.com/recordings` once a
credential resolves, so a key alone is a complete configuration. The hosted
client re-resolves the credential on every request, so a rotation heals a
long-lived MCP server or SDK client without a restart.

What this removes:

- `resolveTransport()` and the own env-selection chain behind it (breaking):
  the two-variable presence test, the `HASNA_RECORDINGS_CLIENT_STORE` switch
  (`sqlite` | `http`, which this branch no longer reads at all), the
  partial-pair fail-closed warnings, and the `TransportResolution` /
  `ClientStore` / `TransportKind` public types. Nothing reads
  `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna` or
  `$XDG_CONFIG_HOME`. No `*_MODE` / `*_STORAGE_MODE` variable exists; the
  transport is decided by what RESOLVES, never by a mode word.
- The `auto:api-url+api-key` store-report source (`AUTO_FLIP_MODE_SOURCE`):
  `recordings check` now names the ACTUAL credential + authority sources (an
  env key name, a Keychain item reference, a file path, or the gateway
  default) and warns when the credential came from the process env, because a
  shell export is a snapshot a rotation cannot heal until the shell exits.
- The old SDK docs telling consumers to read `process.env.HASNA_RECORDINGS_API_URL`
  / `HASNA_RECORDINGS_API_KEY` themselves (a private copy of the chain per
  consumer).

What this adds:

- `resolveRecordingsTransport`, `resolveRecordingsCloudClient` and
  `getRecordingsTransportStatus` on the `./storage` surface, with the crossed
  `@hasna/contracts` types spelled locally so the published declarations stay
  boundary-clean.
- `@hasna/recordings/sdk` exports `resolveRecordingsSdkTransport`,
  `createRecordingsV1Client` and `RECORDINGS_LOCAL_SERVE_URL`, so a consumer
  can see WHICH tier supplied its credential (never the value) and build the
  hosted `/v1` client without writing a private copy of the chain.
- The deliberate unhosted opt-in `HASNA_RECORDINGS_LOCAL=1` (alias
  `RECORDINGS_LOCAL=1`): the on-box SQLite file is reachable only through it,
  it is answered BEFORE the resolver runs (an opted-in run reads neither the
  Keychain nor any credential file), a configured authority outranks it, and
  every local SDK run prints one "LOCAL mode" line on stderr.

Behaviour worth knowing about:

- Hosted mode with no credential still fails closed — non-zero exit, no SQLite,
  no local-fallback event — and the message now names every tier it consulted
  behind a stable `REMOTE_API_*` code (`REMOTE_API_CONFIG_MISSING`,
  `REMOTE_API_CREDENTIAL_INVALID`, `REMOTE_API_URL_INVALID`).
- A credential with no URL used to be refused as a half-configured pair; it
  now resolves the fleet gateway, so `HASNA_RECORDINGS_API_KEY` alone is a
  complete hosted configuration.
- `RECORDINGS_API_KEY` keeps its older meaning — the OpenAI transcription-key
  override (credential-seam waiver in `src/lib/config.ts`) — and BOTH
  unprefixed spellings (`RECORDINGS_API_URL`, `RECORDINGS_API_KEY`) are carved
  out of the resolver environment: an OpenAI key can never authenticate as a
  Hasna credential, and a workstation combining `HASNA_RECORDINGS_LOCAL=1`
  with a plain `RECORDINGS_API_KEY` still lands on the local store.
- A declared-but-blank authority variable no longer disables the Keychain tier
  (the `keychain.enabled` carry across the normalising copy, hasna/apps#1788),
  and the SDK never consults the ambient chain for an explicit `baseUrl`, so a
  pinned authority cannot attract the fleet key (hasna/apps#1794).
- An authority URL carrying userinfo is REFUSED by the resolver instead of
  reaching the transport, so `recordings check` reports the refusal rather
  than redacting a password out of a URL that was about to be used.
- `@hasna/contracts` stays a runtime dependency (unchanged position): the
  serve bundle externalises it for `@hasna/contracts/auth`, and the SDK entry
  imports it; the CLI and MCP bundles inline it as before.