# @hasna/capacity

> **WIP CHECKPOINT — NO-GO.** This branch is preserved for local review only.
> The Accounts V1 successor contract is not independently approved or pinned,
> and the credential-effect journal still targets an obsolete candidate. Do not
> deploy, merge to `main`, publish, or treat `ACCOUNTS_V1_CONTRACT_SHA256` as a
> successor attestation until the exact contract, implementation, and final
> adversarial gates all pass.
>
> The current immutable but unpinned review pair is preserved under
> [`contracts/accounts-v1`](contracts/accounts-v1/README.md). Its presence on
> this branch is provenance only, not approval.

Accounts is the fail-closed provider-capacity metadata boundary for Hasna
deployments. Storage is chosen explicitly: a SQLite-or-HTTP client, and a server
that holds its own state in SQLite or PostgreSQL. It models provider accounts,
entitlements, capacity pools, account lanes, credential bindings, native
AuthCapsule metadata, signed authority evidence, and non-reservational slot
eligibility.

Implemented adapters and surfaces:

- deterministic in-memory and owner-only SQLite repositories;
- RLS-isolated PostgreSQL as a server data backend;
- persistent signed recovery and credential-effect journals outside the
  restorable catalog;
- closed Ed25519 authority evidence and online generation-check receipts;
- explicit SQLite-or-HTTP SDK store selection with no fallback;
- authenticated HTTP handlers and generated OpenAPI 3.1;
- a safe read/diagnostic CLI over the SQLite store.

Accounts does not issue Infinity resource leases, schedule work, run provider
calls, return raw credential handles, launch processes, or provide SaaS tenant,
signup, billing, or public registration features. Ordinary model-call effects
remain broker/Run-Authority owned. Credential lifecycle execution requires the
separate one-use capsule-maintenance authority and external effect journal.

## Build and verify locally

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Install the CLI artifact

Bun blocks dependency lifecycle scripts unless a package is explicitly trusted.
An ordinary Bun install is therefore fail-closed: if the blocked lifecycle
leaves `dist/cli.js` writable by group or world, `capacity` refuses to run. The
packaged launcher opens that payload without following symlinks, verifies the
open descriptor is a regular file with an acceptable mode, and evaluates only
the bytes read from that descriptor. Trusting the package during installation
lets the lifecycle hardener normalize both launcher and payload to mode `0755`:

```sh
bun add --trust @hasna/capacity
bun add --global --trust @hasna/capacity
```

An npm install runs the same permission-hardening lifecycle automatically:

```sh
npm install --global @hasna/capacity
```

The package remains a Bun CLI; an npm-based install still requires Bun on
`PATH`.

The live PostgreSQL conformance test is opt-in and expects an empty disposable
database:

```sh
ACCOUNTS_TEST_POSTGRES_URL='postgresql://user@127.0.0.1/accounts_test?sslmode=disable' \
  bun test test/storage/postgres-live.test.ts
```

Plaintext PostgreSQL is accepted only by this explicit loopback test path.
Networked connections require `sslmode=verify-full`.

## CLI

```sh
HASNA_ACCOUNTS_STORE=sqlite capacity doctor --json
capacity validate ./record.json --json
HASNA_ACCOUNTS_STORE=sqlite capacity list access-methods --json
HASNA_ACCOUNTS_STORE=sqlite capacity get access-methods <uuidv7> --json
HASNA_ACCOUNTS_STORE=sqlite capacity eligibility <account-lane-uuidv7> \
  --operation responses.create \
  --model model.example \
  --data-classification internal \
  --json
```

Store selection is explicit and never inferred. `HASNA_ACCOUNTS_STORE=sqlite`
selects the on-disk SQLite store; `http` reaches a server. The retired
`HASNA_ACCOUNTS_DEPLOYMENT` variable and the retired `local`, `self_hosted`,
`self-hosted`, `cloud`, `remote`, and `hybrid` values are rejected with a message
naming the replacement — they are never normalized to a default.

Positive evaluation requires an explicitly configured, owner-only signed
recovery ledger through the SDK/factory. Without it, readiness and eligibility
stay on recovery hold. CLI output is local diagnostic evidence only and never a
reservation or production Infinity authority.
