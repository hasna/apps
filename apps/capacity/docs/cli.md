# CLI reference

The `capacity` executable requires Bun. Commands that open the catalog require
`HASNA_ACCOUNTS_DEPLOYMENT=local`; there is no implicit deployment or fallback.

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
| `HASNA_ACCOUNTS_DEPLOYMENT` | Must be `local` for catalog commands; `self_hosted` returns `NOT_IMPLEMENTED`. |
| `HASNA_ACCOUNTS_DATABASE_PATH` | Optional absolute SQLite path; defaults to `~/.hasna/accounts/accounts.db`. |
| `HASNA_ACCOUNTS_CAPACITY_API_URL` | Reserved; rejected in local mode. |
| `HASNA_ACCOUNTS_CAPACITY_AUTH_REF` | Reserved; rejected in local mode. |

Offline commands do not create a catalog and need no deployment configuration.

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
