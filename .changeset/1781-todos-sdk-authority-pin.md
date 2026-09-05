---
"@hasna/todos": patch
---

Stop the `./sdk` client sending the station's fleet credential to a
caller-supplied `baseUrl` (hasna/apps#1781 review follow-up, regression from
hasna/apps#1788).

Making credential resolution per-call gave `TodosClient` a `currentApiKey()`
that re-ran the resolver on every request — but it re-ran it with no `baseUrl`,
dropping the tier-1 authority the constructor was given. For
`new TodosClient({ baseUrl: X })` with no `apiKey`, construction correctly took
the explicit-authority arm and held no credential, and then every request
resolved the AMBIENT chain (Keychain, `~/.hasna/todos/config/credentials`,
`HASNA_TODOS_API_KEY`) and attached that key as `x-api-key` on the way to `X`.
`baseUrl` is a documented public option, and the shape with no key is what
local-serve and test-double callers write — including this repo's own tests
against `http://localhost:19427` — so a hosted credential was going to an
unauthenticated on-box process. It also contradicted the guarantee the same
change documented: the service authority is fixed for the life of a client
because a credential written for one authority must never be sent to another.

The authority pin now binds the credential. When tier 1 named the authority the
chain is not consulted again: the client sends the credential it was
CONSTRUCTED with — an explicit `apiKey`, or nothing. Per-call re-resolution, and
the rotation-healing it exists for, still applies to a client that resolved its
own hosted authority. Regression tests cover `new TodosClient({ baseUrl })` with
no key, with a key, and the rotating hosted client that must still re-resolve.

Also in this change:

- `createTodosV1Client()`'s per-request `fetch` wrapper normalises the headers
  init through `Headers` instead of an object spread with a
  `Record<string, string>` cast. The generated client hands it a plain record
  today, but that was asserted only in a comment — a regenerated client passing
  a `Headers` instance or a tuple array would have spread to `{}` and silently
  dropped every header, `Content-Type` included. The wrapper also no longer
  forwards `notice` into its re-resolution, which could print the "LOCAL mode —
  … not the hosted fleet" line while the client was still addressing its
  original hosted authority.
- `resolveTodosSdkTransport()` walks the credential chain once instead of twice.
  `resolveClientTransport()` resolves the credential but returns only its
  source, so reading the value meant a second full pass — and on macOS each pass
  spawns `/usr/bin/security`, so a per-request surface paid two spawns per
  request for one answer (measured: 3 `security` invocations per resolution, now
  2). The resolved value is handed down as the chain's tier-1 argument, so the
  second pass short-circuits; the reported `apiKeySource` is still the true tier
  (`keychain:…`, a file path, an env name), never `"explicit apiKey argument"`.

Bundled `@hasna/todos-sdk` (`apps/todos/sdk`, published separately and NOT a
workspace member, so changesets cannot version it — bumped by hand to **0.2.0**,
which is the release vehicle for the behaviour hasna/apps#1788 documented but
shipped without one):

- A resolved credential with no authority no longer targets `localhost`. The
  local-mode notice was gated on "no URL and no key", but the URL still fell
  back to `http://localhost:19427` whenever no URL was named — so with
  `HASNA_TODOS_API_KEY` set and no `HASNA_TODOS_API_URL`, the client went local,
  said nothing, and forwarded the fleet credential to an unauthenticated
  `todos-serve` on the box. A key now selects the fleet gateway
  `https://api.hasna.com/todos`, which is what the `@hasna/todos` `./sdk`
  surface already answered for that identical environment; the two clients no
  longer disagree about where a key is sent. Local mode is unchanged where the
  ruling puts it: no URL and no key, with one stderr line saying so.
- The behaviour has tests. `__resetTodosLocalModeNotice`,
  `TODOS_API_URL_ENV_KEYS`, `TODOS_API_KEY_ENV_KEYS` and
  `TODOS_LOCAL_SERVE_URL` were added as a test seam and a public surface but
  exported from nowhere and referenced by nothing; they are now re-exported from
  the package index and exercised, alongside the new `TODOS_DEFAULT_FLEET_URL`.
- `README.md` documented the hole ("Setting either one turns the notice off and
  uses what you set") and now documents the rule, with the default authority in
  the configuration table.
