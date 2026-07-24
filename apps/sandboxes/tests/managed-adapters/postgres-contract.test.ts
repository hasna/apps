import { expect, test } from "bun:test"
import { createHash, generateKeyPairSync } from "node:crypto"

import {
  POSTGRES_DURABLE_JOURNAL_WITNESS_MIGRATION_V1,
  POSTGRES_DISPOSABLE_TASK_JOURNAL_EFFECT_TRANSITIONS_MIGRATION_V2,
  POSTGRES_DISPOSABLE_TASK_JOURNAL_MIGRATION_V1,
  POSTGRES_DISPOSABLE_TASK_JOURNAL_MIGRATION_V2,
  applyPostgresDisposableTaskJournalMigrationV2,
  applyPostgresDurableJournalWitnessMigrationV1,
  createEd25519DisposableTaskJournalCryptoV1,
  createEd25519DurableJournalWitnessCryptoV1,
  loadPostgresDisposableTaskJournalEffectTransitionsMigrationSourceV2,
  loadPostgresDisposableTaskJournalMigrationSourceV1,
  loadPostgresDisposableTaskJournalMigrationSourceV2,
  loadPostgresDurableJournalWitnessMigrationSourceV1,
  type PostgresClientV1,
  type PostgresSessionV1,
} from "../../src/adapters/managed/postgres"

const digest = (source: string): string =>
  `sha256:${createHash("sha256").update(source).digest("hex")}`

class RejectingIdentityClient implements PostgresClientV1 {
  transactions = 0

  async query<Row extends Record<string, unknown>>(): Promise<Row[]> {
    return [{
      current_user: "unexpected_role",
      current_database: "unexpected_database",
      ssl_in_use: false,
      owner: "unexpected_owner",
      database_oid: 1n,
      cluster_system_identifier: "1",
    }] as unknown as Row[]
  }

  async transaction<T>(_fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    this.transactions += 1
    throw new Error("transaction must not be reached")
  }

  async close(): Promise<void> {}
}

class SetRoleMigrationIdentityClient implements PostgresClientV1 {
  transactions = 0

  constructor(
    readonly kind: "journal" | "witness",
  ) {}

  async query<Row extends Record<string, unknown>>(statement: string): Promise<Row[]> {
    const migrationRole = this.kind === "journal" ? "journal_migration" : "witness_migration"
    if (statement.includes("current_user::text AS current_user")) {
      return [{
        session_user: `${this.kind}_privileged_member`,
        current_user: migrationRole,
        current_database: this.kind,
        database_oid: 42n,
        cluster_system_identifier: this.kind === "journal" ? "100" : "200",
        ssl_in_use: true,
        owner: migrationRole,
        can_create_database: false,
        can_create_temporary: false,
        database_owner_member: false,
        is_superuser: false,
        can_create_db_role: false,
        can_create_role: false,
        can_replicate: false,
        can_bypass_rls: false,
        parent_memberships: 0n,
        settable_memberships: 0n,
      }] as unknown as Row[]
    }
    if (statement.includes("owner.rolname::text AS owner")) {
      return [{ owner: migrationRole }] as unknown as Row[]
    }
    throw new Error("unexpected pre-mutation query")
  }

  async transaction<T>(_fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    this.transactions += 1
    throw new Error("mutation boundary reached")
  }

  async close(): Promise<void> {}
}

test("checked native journal migrations load with their exact published digests", () => {
  expect(digest(loadPostgresDisposableTaskJournalMigrationSourceV1()))
    .toBe(POSTGRES_DISPOSABLE_TASK_JOURNAL_MIGRATION_V1.checksum_sha256)
  expect(digest(loadPostgresDisposableTaskJournalMigrationSourceV2()))
    .toBe(POSTGRES_DISPOSABLE_TASK_JOURNAL_MIGRATION_V2.checksum_sha256)
  expect(digest(loadPostgresDisposableTaskJournalEffectTransitionsMigrationSourceV2()))
    .toBe(POSTGRES_DISPOSABLE_TASK_JOURNAL_EFFECT_TRANSITIONS_MIGRATION_V2.checksum_sha256)
  expect(digest(loadPostgresDurableJournalWitnessMigrationSourceV1()))
    .toBe(POSTGRES_DURABLE_JOURNAL_WITNESS_MIGRATION_V1.checksum_sha256)
})

test("self-hosted migrations fail closed before mutation on the wrong database identity", async () => {
  const keys = generateKeyPairSync("ed25519")
  const journalCrypto = createEd25519DisposableTaskJournalCryptoV1({
    signer_principal: "service:sandboxes-journal",
    signing_key_id: "journal-key-v1",
    private_key: keys.privateKey,
    public_key: keys.publicKey,
  })
  const witnessCrypto = createEd25519DurableJournalWitnessCryptoV1({
    signer_principal: "service:sandboxes-witness",
    signing_key_id: "witness-key-v1",
    private_key: keys.privateKey,
    public_key: keys.publicKey,
  })
  const client = new RejectingIdentityClient()
  const sha = (seed: string) =>
    `sha256:${createHash("sha256").update(seed).digest("hex")}` as const

  await expect(applyPostgresDisposableTaskJournalMigrationV2(client, {
    expected_migration_role: "journal_migration",
    expected_database: "journal",
    expected_journal_cluster_system_identifier: "100",
    runtime_role: "journal_runtime",
    witness_acknowledgement_role: "journal_witness_ack",
    journal_identity_sha256: sha("journal"),
    restore_domain_sha256: sha("journal-restore"),
    external_head_witness_sha256: sha("witness"),
    witness_verification_key_sha256: witnessCrypto.signer.verification_key_sha256,
    signer_principal: journalCrypto.signer.signer_principal,
    signing_key_id: journalCrypto.signer.signing_key_id,
    verification_key_sha256: journalCrypto.signer.verification_key_sha256,
    encrypted_at_rest: true,
  })).rejects.toMatchObject({ code: "integrity_failed" })

  await expect(applyPostgresDurableJournalWitnessMigrationV1(client, {
    expected_migration_role: "witness_migration",
    reader_role: "witness_reader",
    witness_acknowledgement_role: "witness_ack",
    expected_database: "witness",
    protected_journal_cluster_system_identifier: "100",
    expected_witness_cluster_system_identifier: "200",
    encrypted_at_rest: true,
    restore_domain_sha256: sha("witness-restore"),
    witness_identity_sha256: sha("witness-identity"),
    signer_principal: witnessCrypto.signer.signer_principal,
    signing_key_id: witnessCrypto.signer.signing_key_id,
    verification_key_sha256: witnessCrypto.signer.verification_key_sha256,
  })).rejects.toMatchObject({ code: "integrity_failed" })

  expect(client.transactions).toBe(0)
})

test("self-hosted migrations reject SET ROLE session identities before mutation", async () => {
  const keys = generateKeyPairSync("ed25519")
  const journalCrypto = createEd25519DisposableTaskJournalCryptoV1({
    signer_principal: "service:sandboxes-journal",
    signing_key_id: "journal-key-v1",
    private_key: keys.privateKey,
    public_key: keys.publicKey,
  })
  const witnessCrypto = createEd25519DurableJournalWitnessCryptoV1({
    signer_principal: "service:sandboxes-witness",
    signing_key_id: "witness-key-v1",
    private_key: keys.privateKey,
    public_key: keys.publicKey,
  })
  const sha = (seed: string) =>
    `sha256:${createHash("sha256").update(seed).digest("hex")}` as const
  const journal = new SetRoleMigrationIdentityClient("journal")
  const witness = new SetRoleMigrationIdentityClient("witness")

  await expect(applyPostgresDisposableTaskJournalMigrationV2(journal, {
    expected_migration_role: "journal_migration",
    expected_database: "journal",
    expected_journal_cluster_system_identifier: "100",
    runtime_role: "journal_runtime",
    witness_acknowledgement_role: "journal_witness_ack",
    journal_identity_sha256: sha("journal"),
    restore_domain_sha256: sha("journal-restore"),
    external_head_witness_sha256: sha("witness"),
    witness_verification_key_sha256: witnessCrypto.signer.verification_key_sha256,
    signer_principal: journalCrypto.signer.signer_principal,
    signing_key_id: journalCrypto.signer.signing_key_id,
    verification_key_sha256: journalCrypto.signer.verification_key_sha256,
    encrypted_at_rest: true,
  })).rejects.toMatchObject({ code: "integrity_failed" })

  await expect(applyPostgresDurableJournalWitnessMigrationV1(witness, {
    expected_migration_role: "witness_migration",
    reader_role: "witness_reader",
    witness_acknowledgement_role: "witness_ack",
    expected_database: "witness",
    protected_journal_cluster_system_identifier: "100",
    expected_witness_cluster_system_identifier: "200",
    encrypted_at_rest: true,
    restore_domain_sha256: sha("witness-restore"),
    witness_identity_sha256: sha("witness-identity"),
    signer_principal: witnessCrypto.signer.signer_principal,
    signing_key_id: witnessCrypto.signer.signing_key_id,
    verification_key_sha256: witnessCrypto.signer.verification_key_sha256,
  })).rejects.toMatchObject({ code: "integrity_failed" })

  expect(journal.transactions).toBe(0)
  expect(witness.transactions).toBe(0)
})
