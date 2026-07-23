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
`local` and `self_hosted` deployments. It models provider accounts,
entitlements, capacity pools, account lanes, credential bindings, native
AuthCapsule metadata, signed authority evidence, and non-reservational slot
eligibility.

Implemented adapters and surfaces:

- deterministic in-memory and owner-only SQLite repositories for local use;
- RLS-isolated PostgreSQL for Hasna-owned AWS self-hosting;
- persistent signed recovery and credential-effect journals outside the
  restorable catalog;
- closed Ed25519 authority evidence and online generation-check receipts;
- local/self-hosted SDK selection with no fallback;
- authenticated HTTP handlers and generated OpenAPI 3.1;
- a safe local read/diagnostic CLI.

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
The supported Bun install paths therefore use `--trust` so the package can
normalize the effective executable target to owner-writable mode `0755`:

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
Self-hosted connections require `sslmode=verify-full`.

## Local CLI

```sh
HASNA_ACCOUNTS_DEPLOYMENT=local capacity doctor --json
capacity validate ./record.json --json
HASNA_ACCOUNTS_DEPLOYMENT=local capacity list access-methods --json
HASNA_ACCOUNTS_DEPLOYMENT=local capacity get access-methods <uuidv7> --json
HASNA_ACCOUNTS_DEPLOYMENT=local capacity eligibility <account-lane-uuidv7> \
  --operation responses.create \
  --model model.example \
  --data-classification internal \
  --json
```

Positive local evaluation requires an explicitly configured, owner-only signed
recovery ledger through the SDK/factory. Without it, readiness and eligibility
stay on recovery hold. CLI output is local diagnostic evidence only and never a
reservation or production Infinity authority.
