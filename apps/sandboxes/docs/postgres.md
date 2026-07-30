# PostgreSQL journal and witness

`@hasna/sandboxes/postgres` exports the optional durable disposable-task journal
and its independent witness. This subpath requires Bun because the convenience
`connect` methods use `bun:sql`; callers can instead provide the narrow
`PostgresClientV1` and `PostgresSessionV1` ports.

## Supported database

PostgreSQL 16 is the only currently supported and verified major version. The
identity checks depend on PostgreSQL 16 catalog behavior, including
`pg_auth_members.set_option`, and the live integration harnesses intentionally
run PostgreSQL 16 binaries.

Every migration, runtime, reader, and acknowledgement connection must log in
directly as its configured least-privilege role. Both `session_user` and
`current_user` must equal that role. Membership plus `SET ROLE` is rejected.
Cluster superusers remain outside this application boundary because they can
replace both identities with `SET SESSION AUTHORIZATION`.

## Separation requirements

The journal and witness are deliberately separate authorities:

- Run the witness on a different PostgreSQL cluster from the protected journal.
- Use distinct migration, journal runtime, witness reader, and acknowledgement
  roles as required by the option types.
- Use a separate journal-side acknowledgement client; it must not be the same
  object as the runtime client.
- Set `encrypted_at_rest: true`; initialization rejects any other value.
- Pin expected database names, cluster system identifiers, identities, restore
  domains, signer principals, key IDs, and verification-key digests.
- Supply matching Ed25519 signer/verifier pairs, or construct them with the
  exported `createEd25519DisposableTaskJournalCryptoV1` and
  `createEd25519DurableJournalWitnessCryptoV1` helpers.

The journal cryptographically verifies its own records and the independent
witness verifies its own receipts. Neither validates the caller-owned Infinity
authority signature or interprets tenant/principal semantics.

## TLS and clients

`PostgresDisposableTaskJournalV1.connect` and
`PostgresDurableJournalWitnessV1.connect` require PostgreSQL URLs whose scheme
is `postgres:` or `postgresql:` and whose query contains
`sslmode=verify-full`, plus explicit CA bytes. The witness convenience method
takes separate reader and acknowledgement URLs.

For another client library, implement:

```ts
interface PostgresSessionV1 {
  query<Row extends Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<Row[]>
}

interface PostgresClientV1 extends PostgresSessionV1 {
  transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T>
  close(): Promise<void>
}
```

Callable client objects are valid when they carry these methods. Migration and
initialization fail closed if a supplied client/session is not query-capable or
if a client is not transaction-capable.

## Migrations

Published migration files are included under:

```text
migrations/disposable-task-journal/0001_disposable_task_journal.sql
migrations/disposable-task-journal/0002_disposable_task_intent_v2.sql
migrations/disposable-task-journal/0003_disposable_task_effect_transitions_v2.sql
migrations/durable-journal-witness/0001_durable_journal_witness.sql
```

Use `applyPostgresDisposableTaskJournalMigrationV2` for the current journal
target and `applyPostgresDurableJournalWitnessMigrationV1` for the witness.
The V1 journal apply function remains exported for a V1-only target. Exported
loaders and migration constants expose the packaged source, path, and pinned
checksum.

Migrations are atomic and roll-forward-only. Before applying missing entries,
the migration code verifies that the existing ledger is an exact stable prefix
with matching checksums. There is no down migration. A failed transaction
leaves the prior stable prefix unchanged; recovery reruns the same target.

## Verification

Run the PostgreSQL integration harnesses against disposable local PostgreSQL 16
clusters:

```sh
bun run test:postgres
```

The command runs both the disposable journal and independent-witness suites.
It requires the PostgreSQL 16 server/client binaries used by the repository
scripts.
