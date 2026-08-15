# @hasna/capacity

`@hasna/capacity` is a fail-closed catalog for provider accounts, entitlements,
capacity pools, access lanes, credential-binding metadata, and non-reservational
eligibility. It is for platform engineers and service authors that need to
check whether a provider slot is eligible without scheduling work, issuing a
lease, or exposing a credential. Add the library with
`bun add @hasna/capacity`, or install the `capacity` CLI with
`bun add --global --trust @hasna/capacity`.

Capacity provides a TypeScript SDK, a read and diagnostic CLI, authenticated
HTTP handlers, and an OpenAPI 3.1 document. Catalog data can use on-box SQLite
or a server backed by PostgreSQL. Some TypeScript identifiers, environment
variables, and wire schemas retain the earlier `Accounts` prefix for
compatibility.

Capacity does not issue Infinity leases, schedule work, run provider calls,
return raw credential handles, launch processes, or provide SaaS tenant, signup,
billing, or registration features. Capacity queries always report
`reservation: "none"`.

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

## Quick start

Confirm the installed CLI and inspect its offline commands:

```sh
capacity --version
capacity --help
```

`validate` and `probe-native` work without opening a catalog. Commands that
read catalog data require either an on-box SQLite catalog or an HTTPS capacity
server.

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

The current SDK discriminant is explicit: `mode: "local"` opens SQLite, while
`mode: "self_hosted"` uses the HTTPS server client. Server failures never fall
back to SQLite. SQLite writes require an `idempotencyKey`, and positive
readiness and eligibility require a configured owner-only signed recovery
ledger.
See [`docs/library.md`](docs/library.md).

## CLI

```sh
capacity --help
capacity validate ./record.json --json
capacity probe-native ./request.json ./snapshot.json \
  --owner principal:human:hasna:alice --json
capacity doctor --json
capacity list access-methods --json
capacity eligibility <account-lane-uuidv7> \
  --operation responses.create --model model.example \
  --data-classification internal --destination-policy-class default --json
```

`validate`, `probe-native`, `help`, and `version` do not open the catalog.
Catalog commands open the on-box SQLite store by default (also selectable
explicitly with `HASNA_ACCOUNTS_DEPLOYMENT=local`), while `self_hosted` uses an
API origin with a configured credential resolver; self-hosted configuration
without that selector stays fail-closed. CLI eligibility is diagnostic evidence, never a
reservation or production Infinity authority. See [`docs/cli.md`](docs/cli.md).

## HTTP

`createAccountsHttpHandler` exposes authenticated public and internal routes,
plus unauthenticated health, readiness, version, and OpenAPI endpoints. The
package does not start a server. See [`docs/http-api.md`](docs/http-api.md) and
[`openapi/accounts.capacity.v1.json`](openapi/accounts.capacity.v1.json).

## Contract provenance

The content-addressed files in
[`contracts/accounts-v1`](contracts/accounts-v1/README.md) are an unpinned
review candidate preserved for provenance. Their presence is not approval, and
`ACCOUNTS_V1_CONTRACT_SHA256` does not attest that candidate.

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
ACCOUNTS_TEST_POSTGRES_URL='<disposable loopback PostgreSQL URL>' \
  bun test test/storage/postgres-live.test.ts
```

Plaintext PostgreSQL is accepted only by this explicit literal-loopback test
path. Server connections require `sslmode=verify-full`.
