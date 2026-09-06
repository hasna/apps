---
"@hasna/hooks": minor
---

Resolve the registry credential through the `@hasna/contracts` client chain (hasna/apps#1720).

The CLI, the MCP server and the `./sdk` surface no longer carry a credential chain
of their own. All of them call the one resolver in `@hasna/contracts` (pinned
1.0.2, a build-time dependency inlined into the bundle), fresh per request. The
chain reads, per call: an explicit `--api-key`/`--profile`, then
`HASNA_HOOKS_API_KEY_OVERRIDE` / `HASNA_PROFILE` / `HASNA_HOOKS_API_KEY_REF`,
then the macOS Keychain items `hasna.credentials.hooks.api-key` / `.api-url`,
then `~/.hasna/hooks/config/credentials` (owner-only 0400/0600), then
`HASNA_HOOKS_API_KEY`. The registry URL follows the same ladder —
`HASNA_HOOKS_API_URL`, the Keychain `api-url` item, the credentials file — and
now DEFAULTS to the fleet gateway `https://api.hasna.com/hooks` once a
credential resolves, so a key alone is a complete configuration. Resolving per
call is what makes a key rotation heal a long-lived shell, MCP server or daemon
without restarting it: `hooks serve` re-resolves the publish key on every PUT,
and `hooks sync` re-resolves on every invocation.

The pair is STRICT: a registry URL without a credential is a refusal
(`REMOTE_API_KEY_MISSING` / `REMOTE_API_CONFIG_MISSING`), never half-open
progress and never a silent local read. Hosted mode with no credential still
fails closed — non-zero exit, no SQLite fallback, no local-fallback event — and
the message names every tier it consulted. Local mode (bundled registry + local
SQLite store) is reachable ONLY through the explicit opt-in
`HASNA_HOOKS_LOCAL=1` (alias `HOOKS_LOCAL=1`), is answered BEFORE the resolver
runs (so an unhosted run touches neither the Keychain nor the credential file),
and prints one "LOCAL mode" line on stderr per process.

What this removes (breaking, hence minor):

- The app's own env/URL ladder — `resolveApiUrl()` reading
  `HASNA_HOOKS_API_URL` / `HOOKS_API_URL` / `HASNA_HOOKS_REGISTRY_URL` /
  `HOOKS_REGISTRY_URL` and then the `api_url` field of
  `~/.hasna/hooks/config.json` — together with `readConfig()` / `writeConfig()`,
  `getConfigPath()` and `HooksConfig`. The `config.json` key store is retired
  and never read; `hooks init --cloudflare` now prints the exact env
  configuration instead of writing the file.
- `resolveApiKey()` (the loose "key only required for publish" helper) and
  `isApiModeConfigured()` / `isLocalModeOptedIn()`, replaced by
  `resolveHooksTransport()` / `resolveHooksServePublishKey()` and the
  `local-opt-in` preamble.
- The retired locations, everywhere: nothing reads `~/.hasna/fleet-env`,
  `~/.hasna/cloud`, `~/.config/hasna` or `$XDG_CONFIG_HOME`, and no `*_MODE` /
  `*_STORAGE_MODE` transport switch exists.

What this adds:

- `resolveHooksTransport(env?, options?)` and `resolveHooksServePublishKey(env?,
  options?)` on the package root, so a consumer can see WHICH tier supplied its
  credential (never the value) and re-resolve per request without writing a
  private copy of the chain. The crossing types (`HooksCredentialOptions` etc.)
  are spelled locally so the published `.d.ts` never imports `@hasna/contracts`
  (#1782).
- A declared-but-blank authority variable no longer disables the Keychain tier:
  blanking is normalised before the resolver sees it and the ambient gate is
  carried across as `keychain.enabled` (#1788). `syncHooks()` / `planSync()` /
  `fetchPinnedHook()` accept an injectable `env`/`credentials` for hermetic
  callers; the credential is pinned to the authority it resolved with (#1794).
- Hermetic tests: credential-resolution (injected `security` runner + fake
  HOME), strict-pair/fail-closed (no SQLite created on refusal), and
  transport-report (sources named, values never).
