# Library reference

## High-level SDK

`createAccountsCapacity(config)` accepts a closed local or self-hosted config;
unknown and missing keys fail validation.

```ts
const local = createAccountsCapacity({
  mode: "local",
  actorRef: "principal:service:hasna:worker",
  sqlitePath: "/var/lib/hasna/accounts.db",
  recovery: {
    ledgerPath: "/var/lib/hasna/accounts.recovery.log",
    catalogIncarnation: "accounts-primary",
    signingKey,
  },
});
```

Local principals match `principal:(human|service):hasna:<id>`. SQLite and
recovery paths must be absolute and normalized. SQLite defaults to
`~/.hasna/accounts/accounts.db`. Omitting recovery prevents positive eligibility
and leaves readiness metadata-only or on recovery hold.

```ts
const remote = createAccountsCapacity({
  mode: "self_hosted",
  baseUrl: "https://capacity.internal.example",
  authProvider: { async authorize(headers) { headers.set("authorization", bearer); } },
});
```

The remote base URL must be an HTTPS origin root without credentials, query,
fragment, or non-root path. Cookies, API-key and proxy/legacy auth headers are
rejected. Closed response validation and transport failures never fall back.

## SDK namespaces

| Property | Operations |
| --- | --- |
| `providerAccounts` | `list`, `get`, `create` |
| `entitlements` | `list`, `get`, `create` |
| `capacityPools` | `list`, `get` |
| `lanes` | `list`, `get`, `create` |
| `capsules` | `list`, `get`, `createBootstrapIntent`, `getBootstrapIntent` |
| `credentialBindings` | `list`, `get` metadata only |
| `capacity` | `query` diagnostic eligibility |

Lists accept opaque `cursor` and `limit` 1–100. Mutations require an idempotency
key; bootstrap intent creation also requires an expected revision. Calls accept
`AbortSignal`; call `close()` when finished. Provider subjects and credential
handles are never returned by normal readers.

## Read-only factories

- `createInMemoryAccounts({ clock? })` provides ephemeral metadata.
- `createSQLiteAccounts({ path, recovery?, clock? })` provides local persistence.
- `createPostgresAccounts(options)` initializes self-hosted PostgreSQL.

They return `get`, `list`, `eligibility`, `checkCurrent`, `doctor`, and `close`.
Memory is metadata-only. PostgreSQL requires a validated Hasna principal, forced
RLS, the `accounts_runtime` role, and `sslmode=verify-full`; plaintext is only
available through the explicit literal-loopback test option.

The root module also exports `createAccountsHttpHandler`, the runtime OpenAPI
document, closed DTO validators, domain and ID types, evidence verification,
and storage authority helpers. Validate untrusted wire input before use.
