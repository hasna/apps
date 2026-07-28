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

Local CLI reads and API reads emit the same record schema: both apply the one
reader projection, so `providerSubjectRef` is disclosed by neither deployment
mode and normal output and `--json` stay on the same redactor.

## Self-hosted CLI

`HASNA_ACCOUNTS_CAPACITY_AUTH_REF` is a Secrets-managed capacity client
credential *reference*. It is not a bearer token, and Accounts never puts it on
the wire — resolving it into the separately audienced credential is a
deployment-owned Secrets capability. This package ships no resolver, so the
deployment names its own through
`HASNA_ACCOUNTS_CAPACITY_CREDENTIAL_COMMAND`: an absolute path to an executable
that receives the reference as its only argument and writes the audienced
credential to stdout. The variable holds a command path, never credential
material, and the command's stderr is never captured or printed:

```sh
HASNA_ACCOUNTS_DEPLOYMENT=self_hosted \
HASNA_ACCOUNTS_CAPACITY_API_URL=https://accounts.capacity.example \
HASNA_ACCOUNTS_CAPACITY_AUTH_REF=capacity-client-reference \
HASNA_ACCOUNTS_CAPACITY_CREDENTIAL_COMMAND=/opt/hasna/bin/capacity-credential \
  capacity list access-methods --json
```

The command is held to the same artifact rule as the launcher payload: a
regular file that is not group- or world-writable, or the CLI refuses with
`POLICY_DENIED` (exit 7) before the reference is handed over. Without a
resolver command the packaged binary refuses `self_hosted` commands with
`DEPENDENCY_UNAVAILABLE` (exit 6) before any request is built — it never
invents a credential source.

Embedders that already hold a Secrets client can inject the resolver directly
instead of shelling out, through the same CLI entry point the packaged binary
runs:

```ts
import { runAccountsCli } from "@hasna/capacity/cli";

const exitCode = await runAccountsCli(process.argv.slice(2), {
  credentialResolver: secretsResolver,
});
```

Self-hosted reads are also reachable through the SDK, which takes the same
deployment-owned resolver and uses the same HTTPS Accounts Capacity API routes:

```ts
import { createAccountsCapacity, createReferenceAuthProvider } from "@hasna/capacity";

const capacity = createAccountsCapacity({
  mode: "self_hosted",
  baseUrl: "https://accounts.capacity.example",
  authProvider: createReferenceAuthProvider("capacity-client-reference", secretsResolver),
});
```

`createReferenceAuthProvider` fails closed when the resolver returns the
reference itself or a value that is not a usable credential. Local database
configuration is refused in `self_hosted` mode.

Every read surface — local CLI, packaged CLI in `self_hosted` mode, and the
HTTP API — emits the same redacted account projection, and `capacity validate`
accepts it, so `capacity get accounts <id> | capacity validate -` round-trips
in both deployment modes.
