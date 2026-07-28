# @hasna/capacity

Fail-closed provider account capacity metadata for local and self-hosted Hasna deployments.

Capacity models provider accounts, entitlements, capacity pools, account lanes,
credential bindings, native AuthCapsule metadata, signed authority evidence,
and non-reservational slot eligibility. Public TypeScript names, environment
variables, and wire schemas retain `Accounts` for compatibility.

Implemented surfaces include deterministic in-memory storage, owner-only SQLite,
RLS-isolated PostgreSQL, signed recovery and effect journals, local/self-hosted
SDKs with no fallback, authenticated HTTP handlers, OpenAPI 3.1, and a local
read/diagnostic CLI with offline validation and native probing.

Capacity does not issue Infinity leases, schedule work, run provider calls,
return raw credential handles, launch processes, or provide SaaS tenant, signup,
billing, or registration features. Capacity queries always report
`reservation: "none"`.

> The content-addressed files in [`contracts/accounts-v1`](contracts/accounts-v1/README.md)
> are an unpinned review candidate preserved for provenance. Their presence is
> not approval, and `ACCOUNTS_V1_CONTRACT_SHA256` does not attest that candidate.

## Install

The package and CLI require Bun 1.3 or later:

```sh
bun add @hasna/capacity
bun add --global --trust @hasna/capacity
```

Bun blocks dependency lifecycle scripts unless explicitly trusted. The library
remains usable, but the packaged CLI refuses a `dist/cli.js` payload writable by
group or world. Trust allows the postinstall hardener to normalize file modes.
An npm global install runs the hardener but still requires Bun on `PATH`:

```sh
npm install --global @hasna/capacity
```

## Library

```ts
import { createAccountsCapacity } from "@hasna/capacity";

const capacity = createAccountsCapacity({
  mode: "local",
  actorRef: "principal:human:hasna:alice",
  sqlitePath: "/var/lib/hasna/accounts.db",
});
const accounts = await capacity.providerAccounts.list({ limit: 25 });
await capacity.close();
```

Deployment selection is explicit; self-hosted failures never fall back to
SQLite. Local writes require an `idempotencyKey`. Positive local readiness and
eligibility require a configured owner-only signed recovery ledger.
See [`docs/library.md`](docs/library.md).

## CLI

```sh
capacity --help
capacity validate ./record.json --json
capacity probe-native ./request.json ./snapshot.json \
  --owner principal:human:hasna:alice --json
HASNA_ACCOUNTS_DEPLOYMENT=local capacity doctor --json
HASNA_ACCOUNTS_DEPLOYMENT=local capacity list access-methods --json
HASNA_ACCOUNTS_DEPLOYMENT=local capacity eligibility <account-lane-uuidv7> \
  --operation responses.create --model model.example \
  --data-classification internal --destination-policy-class default --json
```

`validate`, `probe-native`, `help`, and `version` do not open the catalog.
Catalog commands currently support only explicit local deployment. CLI
eligibility is diagnostic evidence, never a reservation or production Infinity
authority. See [`docs/cli.md`](docs/cli.md).

## HTTP

`createAccountsHttpHandler` exposes authenticated public and internal routes,
plus unauthenticated health, readiness, version, and OpenAPI endpoints. The
package does not start a server. See [`docs/http-api.md`](docs/http-api.md) and
[`openapi/accounts.capacity.v1.json`](openapi/accounts.capacity.v1.json).

## Build and verify

```sh
bun install
bun test
bun run typecheck
bun run build
bun openapi/generate.ts
git diff --exit-code -- openapi/accounts.capacity.v1.json
```

The live PostgreSQL test is opt-in and requires an empty disposable database:

```sh
ACCOUNTS_TEST_POSTGRES_URL='postgresql://user@127.0.0.1/accounts_test?sslmode=disable' \
  bun test test/storage/postgres-live.test.ts
```

Plaintext PostgreSQL is accepted only by this explicit literal-loopback test
path. Self-hosted connections require `sslmode=verify-full`.
