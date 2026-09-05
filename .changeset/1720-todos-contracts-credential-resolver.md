---
"@hasna/todos": minor
---

Resolve credentials through the `@hasna/contracts` client chain (hasna/apps#1720).

The CLI, the MCP server and the `./sdk` client no longer carry a credential
chain of their own. All three call the one resolver in `@hasna/contracts`
(bumped to 1.0.1), which reads, per call: an explicit `--api-key`/`--profile`,
then `HASNA_TODOS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
`HASNA_TODOS_API_KEY_REF`, then the macOS Keychain item
`hasna.credentials.todos.api-key`, then `~/.hasna/todos/config/credentials`
(owner-only 0400/0600), then `HASNA_TODOS_API_KEY`. The authority follows the
same ladder — `HASNA_TODOS_API_URL`, the Keychain `api-url` item, the
credentials file — and now DEFAULTS to the fleet gateway
`https://api.hasna.com/todos` once a credential resolves, so a key alone is a
complete configuration. Resolving per call is what makes a key rotation heal a
long-lived shell, MCP server or agent without restarting it: a `TodosClient`
held for hours re-resolves the credential on every request, so the next request
after a rotation carries the new key. The two deliberate exceptions are an
explicit `apiKey` argument (tier 1, a pin the caller owns) and the service
authority, which is fixed for the life of a client so a credential written for
one authority is never sent to another.

What this removes:

- `getLocalApiConfig()` and `LocalApiConfig` (breaking, hence minor), together
  with the `apiUrl` / `apiKey` fields of `TodosConfig`. The SDK used to read a
  credential out of `~/.todos/config.json` — an ordinary-permission file that
  unrelated `todos config` writes rewrite wholesale — and to prefer `TODOS_URL`
  and an unprefixed key name over the canonical `HASNA_TODOS_*` pair, so an
  operator who configured the documented names silently got the localhost
  default with no credential.
- `requireTodosRemoteAuthorityEnv()` (breaking), the pre-normalisation pass the
  resolver now performs itself.
- The retired paths, everywhere: nothing reads `~/.hasna/fleet-env`,
  `~/.hasna/cloud`, `~/.config/hasna` or `$XDG_CONFIG_HOME`. `@hasna/todos/testing`
  delivers a fixture key to `~/.hasna/todos/config/credentials` at 0600 instead.
- The legacy-env DEPRECATED stderr notice, which contracts 1.0.1 drops:
  `HASNA_TODOS_API_KEY` is a legitimate tier, it just sits below disk.

What this adds:

- `@hasna/todos/sdk` exports `resolveTodosSdkTransport`, `createTodosV1Client`
  and `TODOS_LOCAL_SERVE_URL`, so a consumer can see WHICH tier supplied its
  credential (never the value) and build the hosted `/v1` client without writing
  a private copy of the chain.
- `todos storage status` reports `api_url_source`, `api_key_source` and
  `api_key_tier`.
- `@hasna/todos/testing` exports `TODOS_CREDENTIALS_FILE_SEGMENTS` and
  `TODOS_TEST_KEYCHAIN_ACCOUNT`. The scrub list gained the deliberate pointers
  (`HASNA_TODOS_API_KEY_OVERRIDE`, `HASNA_TODOS_API_KEY_REF`, `HASNA_PROFILE`)
  and now REMOVES entries rather than blanking them, because a declared-but-blank
  credential is a refusal rather than an absence. Blanking still means "unset"
  at the Todos seam, so existing consumer fixtures keep working.

Behaviour worth knowing about:

- Hosted mode with no credential still fails closed — non-zero exit, no SQLite
  fallback, no local-fallback event — and the message now names every tier it
  consulted, so the remedy is in the error. The `./sdk` surface differs for that
  ONE case by design: `new TodosClient()` falls to the local `todos-serve` with
  a stderr line, `createTodosV1Client()` throws. Every other refusal throws on
  every surface.
- A declared-but-blank `*TODOS_*` variable no longer disables the Keychain tier.
  Removing a blank means handing the resolver a COPY of the environment, and
  @hasna/contracts gates its ambient tiers on object identity, so the copy used
  to switch tier 3 off for the whole run — silently dropping a station from its
  Keychain identity to the next one in the chain. The gate is now decided before
  normalising and carried across as `keychain.enabled`.
- Local mode (`HASNA_TODOS_LOCAL=1`, alias `TODOS_LOCAL=1`) is honoured only
  when the environment configures no authority and no credential, and is
  answered BEFORE the resolver runs, so an unhosted run reads neither the
  Keychain nor the credential file. Every local run now prints one line on
  stderr saying it is local.
- A credential with no URL used to be refused as a half-configured pair; it now
  resolves the fleet gateway.
- A 401/403 from the authority no longer echoes the server's response body: the
  transport cancels it unread, because that body is the one place a rejected
  request can reflect credential material back into logs. The refusal still
  names the authority and the credential source.
