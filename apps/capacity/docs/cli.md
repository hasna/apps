# CLI reference

The `capacity` executable requires Bun. Commands that open the catalog require
an explicit `HASNA_ACCOUNTS_DEPLOYMENT` — `local` or `self_hosted`; there is no
implicit deployment or fallback.

## Commands

```text
capacity help [--json]
capacity --help [--json]
capacity version [--json]
capacity --version [--json]
capacity validate <file|-> [--json]
capacity probe-native <request-file> <snapshot-file> --owner <principal> [--json]
capacity doctor [--json]
capacity list <accounts|entitlements|capacity-pools|access-methods|auth-capsules|credential-bindings> [--json]
capacity get <noun> <uuidv7> [--json]
capacity eligibility <access-method-uuidv7> --operation <id> --model <id> --data-classification <id> [--destination-policy-class <id>] [--json]
```

Options may precede or follow positionals and cannot repeat. `--json`, `--help`,
and `--version` take no value.

- `validate` reads a closed JSON DTO from a file or stdin (`-`). It accepts
  `accounts.capacity.v1` record envelopes and `accounts.slot-eligibility.v1`.
- `probe-native` reads a request and one binding snapshot from files. It is
  credential- and network-free; `--owner` supplies the evaluating principal.
- `doctor` reports integrity and recovery/readiness state.
- `list` returns all visible records; the CLI has no pagination options.
- `get` requires a UUIDv7 identifier.
- `eligibility` is non-reservational. Destination policy defaults to `default`.

`probe-native` and `eligibility` exit `7` for a valid negative decision.

## Environment

| Variable | Behavior |
| --- | --- |
| `HASNA_ACCOUNTS_DEPLOYMENT` | Required for catalog commands: `local` or `self_hosted`. |
| `HASNA_ACCOUNTS_DATABASE_PATH` | Local only. Optional absolute SQLite path; defaults to `~/.hasna/accounts/accounts.db`. |
| `HASNA_ACCOUNTS_CAPACITY_API_URL` | Self-hosted API origin; rejected in local mode. |
| `HASNA_ACCOUNTS_CAPACITY_AUTH_REF` | Secrets-managed credential *reference*; rejected in local mode. |
| `HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE` | Absolute path or `file:` URL of the resolver module; rejected in local mode. |

Offline commands do not create a catalog and need no deployment configuration.

## Local deployment

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

## Self-hosted deployment

```sh
HASNA_ACCOUNTS_DEPLOYMENT=self_hosted \
HASNA_ACCOUNTS_CAPACITY_API_URL=https://accounts.capacity.example \
HASNA_ACCOUNTS_CAPACITY_AUTH_REF=<secrets-managed-credential-reference> \
HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE=/opt/hasna/capacity-credential-resolver.mjs \
  capacity list credential-bindings --json
```

`HASNA_ACCOUNTS_CAPACITY_AUTH_REF` is a Secrets-managed *reference*, not
credential material, so the CLI never presents it to the API as a bearer
credential. A deployment supplies the resolver that exchanges the reference for
the separately audienced client credential.

`HASNA_ACCOUNTS_CAPACITY_RESOLVER_MODULE` is the absolute path (or `file:` URL)
of that resolver module. The CLI imports it and calls its `resolve` export. The
module runs with the operator's authority, so it is refused unless it is a
regular file that is not group- or world-writable:

```js
// /opt/hasna/capacity-credential-resolver.mjs
export async function resolve(reference, signal) {
  return resolveThroughSecrets(reference, signal);
}
```

An embedding process can inject the same resolver directly instead:

```ts
import { runAccountsCli } from "@hasna/capacity/cli";

await runAccountsCli(process.argv.slice(2), {
  credentialResolver: { resolve: async (reference) => resolveThroughSecrets(reference) },
});
```

Without a configured resolver, self-hosted commands fail closed with
`DEPENDENCY_UNAVAILABLE` (exit 6) rather than sending the reference over the
wire. A local deployment refuses any self-hosted capacity configuration,
including a configured resolver module. `list` walks every page, so a
self-hosted list returns the same record set a local list returns.

Read commands emit the redacted `accounts.capacity-redacted.v1` record envelope
in both deployments — provider subject values never reach CLI output — and
`capacity validate` accepts that envelope from either.

## Output and exits

Successful `--json` output is an `accounts.cli.v1` envelope. Without `--json`,
help is text and other successes print canonical JSON for the data member.
Errors go to stderr as `accounts.error.v1` with `--json`, or as
`<ERROR_CODE>: <public message>` otherwise.

| Code | Meaning |
| ---: | --- |
| `0` | Success or positive decision. |
| `2` | Invalid arguments/DTO or unsupported schema. |
| `3` | Not found. |
| `4` | Conflict, stale revision, invalid transition, or exhausted counter. |
| `5` | Forbidden. |
| `6` | Dependency, recovery, adapter, checksum, or database safety failure. |
| `7` | Valid policy or eligibility denial. |
| `126` | Launcher could not verify a safe regular, non-symlink CLI payload. |
