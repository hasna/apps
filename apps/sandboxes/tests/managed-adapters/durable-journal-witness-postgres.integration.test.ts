import { expect, test } from "bun:test"
import { SQL } from "bun"
import { createHash, generateKeyPairSync } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  PostgresDurableJournalWitnessV1,
  applyPostgresDurableJournalWitnessMigrationV1,
  createEd25519DurableJournalWitnessCryptoV1,
  type PostgresDurableJournalWitnessOptionsV1,
} from "../../src/adapters/managed/durable-journal-witness-postgres"
import {
  PostgresDisposableTaskJournalV1,
  applyPostgresDisposableTaskJournalMigrationV1,
  createEd25519DisposableTaskJournalCryptoV1,
} from "../../src/adapters/managed/disposable-task-postgres"
import { canonicalJson, parseCanonicalJson } from "../../src/adapters/managed/canonical"
import {
  disposableTaskBundleSha256,
  disposableTaskCheckpointPolicySha256,
  disposableTaskInputManifestSha256,
  disposableTaskOperationDigest,
} from "../../src/adapters/managed/disposable-task"
import type { DisposableTaskJournalPrepareInputV1, DurableJournalWitnessPortV1 } from "../../src/adapters/managed/disposable-task"
import type { Digest } from "../../src/adapters/managed/types"
import type { PostgresClientV1, PostgresSessionV1 } from "../../src/repository-postgres"

const REQUIRED_ENV = [
  "SANDBOXES_WITNESS_MIGRATION_URL",
  "SANDBOXES_WITNESS_READER_URL",
  "SANDBOXES_WITNESS_ACK_URL",
  "SANDBOXES_WITNESS_DATABASE",
  "SANDBOXES_WITNESS_MIGRATION_ROLE",
  "SANDBOXES_WITNESS_READER_ROLE",
  "SANDBOXES_WITNESS_ACK_ROLE",
  "SANDBOXES_WITNESS_TLS_CA_FILE",
  "SANDBOXES_JOURNAL_CLUSTER_SYSTEM_IDENTIFIER",
  "SANDBOXES_WITNESS_CLUSTER_SYSTEM_IDENTIFIER",
  "SANDBOXES_MAIN_MIGRATION_URL",
  "SANDBOXES_MAIN_RUNTIME_URL",
  "SANDBOXES_MAIN_ACK_URL",
  "SANDBOXES_MAIN_DATABASE",
  "SANDBOXES_MAIN_MIGRATION_ROLE",
  "SANDBOXES_MAIN_RUNTIME_ROLE",
  "SANDBOXES_MAIN_ACK_ROLE",
] as const

const ENABLED = REQUIRED_ENV.every((name) => Boolean(process.env[name]))

function required(name: typeof REQUIRED_ENV[number]): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
  return value
}

interface SqlLike {
  unsafe(statement: string, parameters?: unknown[]): Promise<unknown[]>
  begin<T>(fn: (sql: SqlLike) => Promise<T>): Promise<T>
  close(options?: { timeout?: number }): Promise<void>
}

class Client implements PostgresClientV1 {
  readonly #sql: SqlLike
  constructor(url: string, ca: Uint8Array) {
    const parsed = new URL(url)
    this.#sql = new SQL({
      url,
      max: 1,
      tls: { ca, serverName: parsed.hostname, rejectUnauthorized: true },
    }) as unknown as SqlLike
  }
  async query<Row extends Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<Row[]> {
    return await this.#sql.unsafe(statement, [...parameters]) as Row[]
  }
  async transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    return await this.#sql.begin(async (sql) => fn({
      query: async <Row extends Record<string, unknown>>(
        statement: string,
        parameters: readonly unknown[] = [],
      ) => await sql.unsafe(statement, [...parameters]) as Row[],
    }))
  }
  async close(): Promise<void> {
    await this.#sql.close({ timeout: 0 })
  }
}

const d = (value: string | Uint8Array): Digest =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`

function advance(
  journal: Digest,
  expectedSequence: bigint,
  expectedFrontier: Digest | null,
  successorFrontier: Digest,
  anchor: string,
): Parameters<DurableJournalWitnessPortV1["compareAndAdvance"]>[0] {
  return {
    journal_identity_sha256: journal,
    expected_sequence: expectedSequence,
    expected_frontier_sha256: expectedFrontier,
    successor_sequence: expectedSequence + 1n,
    successor_frontier_sha256: successorFrontier,
    signed_anchor_bytes: new TextEncoder().encode(anchor),
  }
}

function mainPrepare(seed: string): DisposableTaskJournalPrepareInputV1 {
  const content = Buffer.from(`export const seed = ${JSON.stringify(seed)}\n`, "utf8")
  const files = [{
    path: "src/task.ts",
    content_base64: content.toString("base64"),
    content_sha256: d(content),
    mode: 0o600 as const,
  }]
  const request = {
    schema_version: "sandboxes.disposable-task-request/v1" as const,
    provider: "e2b" as const,
    idempotency_key_sha256: d(`main-idempotency:${seed}`),
    operation_digest: d("placeholder"),
    authority_envelope_sha256: d(`main-authority:${seed}`),
    source_manifest_sha256: d(`main-source:${seed}`),
    input_manifest_sha256: disposableTaskInputManifestSha256(files),
    environment_image_sha256: d("main-e2b-template"),
    task_bundle_sha256: d("placeholder"),
    network_policy: "deny_all" as const,
    maximum_allocations: 1 as const,
    max_runtime_ms: 60_000,
    files,
    exec: {
      argv: ["/usr/bin/true"], cwd: "." as const, wall_timeout_ms: 5_000,
      idle_timeout_ms: 5_000, output_limit_bytes: 4_096, pids_limit: 4,
    },
    checkpoint: {
      allowed_path_prefixes: ["src"], allow_file_addition: true,
      allow_file_modification: true, allow_file_deletion: false,
      max_changed_files: 32, forbidden_content_markers_base64: [], max_depth: 4,
      max_duration_ms: 10_000, max_file_bytes: 65_536, max_files: 32, max_total_bytes: 131_072,
    },
  }
  request.task_bundle_sha256 = disposableTaskBundleSha256(request)
  request.operation_digest = disposableTaskOperationDigest(request)
  const canonical = new TextEncoder().encode(canonicalJson(request))
  return {
    idempotency_key_sha256: request.idempotency_key_sha256,
    request_sha256: d(canonical),
    canonical_request_bytes: canonical,
    operation_digest: request.operation_digest,
    authority_envelope_sha256: request.authority_envelope_sha256,
    source_manifest_sha256: request.source_manifest_sha256,
    input_manifest_sha256: request.input_manifest_sha256,
    checkpoint_policy_sha256: disposableTaskCheckpointPolicySha256(request.checkpoint),
    provider: request.provider,
    provider_metadata_scope_sha256: d(`main-provider-scope:${seed}`),
    provider_creation_token_sha256: d(`main-provider-token:${seed}`),
    immutable_fingerprint_sha256: d(`main-provider-fingerprint:${seed}`),
    lease_owner_sha256: d(`main-lease-owner:${seed}`),
    lease_duration_ms: 60_000,
  }
}

test.skipIf(!ENABLED)("durable witness is independent, signed, CAS-linearized, restart-safe, and least-privilege", async () => {
  const config = {
    migrationUrl: required("SANDBOXES_WITNESS_MIGRATION_URL"),
    readerUrl: required("SANDBOXES_WITNESS_READER_URL"),
    acknowledgementUrl: required("SANDBOXES_WITNESS_ACK_URL"),
    database: required("SANDBOXES_WITNESS_DATABASE"),
    migrationRole: required("SANDBOXES_WITNESS_MIGRATION_ROLE"),
    readerRole: required("SANDBOXES_WITNESS_READER_ROLE"),
    acknowledgementRole: required("SANDBOXES_WITNESS_ACK_ROLE"),
    ca: Uint8Array.from(readFileSync(required("SANDBOXES_WITNESS_TLS_CA_FILE"))),
    journalCluster: required("SANDBOXES_JOURNAL_CLUSTER_SYSTEM_IDENTIFIER"),
    witnessCluster: required("SANDBOXES_WITNESS_CLUSTER_SYSTEM_IDENTIFIER"),
    mainMigrationUrl: required("SANDBOXES_MAIN_MIGRATION_URL"),
    mainRuntimeUrl: required("SANDBOXES_MAIN_RUNTIME_URL"),
    mainAckUrl: required("SANDBOXES_MAIN_ACK_URL"),
    mainDatabase: required("SANDBOXES_MAIN_DATABASE"),
    mainMigrationRole: required("SANDBOXES_MAIN_MIGRATION_ROLE"),
    mainRuntimeRole: required("SANDBOXES_MAIN_RUNTIME_ROLE"),
    mainAckRole: required("SANDBOXES_MAIN_ACK_ROLE"),
  }
  expect(config.journalCluster).not.toBe(config.witnessCluster)

  const keys = generateKeyPairSync("ed25519")
  const crypto = createEd25519DurableJournalWitnessCryptoV1({
    signer_principal: "service:durable-journal-witness",
    signing_key_id: "durable-witness-key-v1",
    private_key: keys.privateKey,
    public_key: keys.publicKey,
  })
  const restoreDomain = d("durable-witness-independent-restore-domain")
  const witnessIdentity = d("durable-witness-postgres-cluster-identity")
  const migration = new Client(config.migrationUrl, config.ca)
  const mainMigration = new Client(config.mainMigrationUrl, config.ca)
  const mainClients: Client[] = []
  const clients: Client[] = []
  const opened: PostgresDurableJournalWitnessV1[] = []

  const newClients = () => {
    const reader = new Client(config.readerUrl, config.ca)
    const acknowledgement = new Client(config.acknowledgementUrl, config.ca)
    clients.push(reader, acknowledgement)
    return { reader, acknowledgement }
  }
  const options = (
    acknowledgement: PostgresClientV1,
    overrides: Partial<PostgresDurableJournalWitnessOptionsV1> = {},
  ): PostgresDurableJournalWitnessOptionsV1 => ({
    expected_migration_role: config.migrationRole,
    expected_reader_role: config.readerRole,
    expected_witness_acknowledgement_role: config.acknowledgementRole,
    expected_database: config.database,
    protected_journal_cluster_system_identifier: config.journalCluster,
    expected_witness_cluster_system_identifier: config.witnessCluster,
    encrypted_at_rest: true,
    restore_domain_sha256: restoreDomain,
    witness_identity_sha256: witnessIdentity,
    signer: crypto.signer,
    verifier: crypto.verifier,
    witness_acknowledgement_client: acknowledgement,
    ...overrides,
  })
  const connect = async () => {
    const pair = newClients()
    const witness = await PostgresDurableJournalWitnessV1.fromClients(
      pair.reader,
      options(pair.acknowledgement),
    )
    opened.push(witness)
    return { witness, ...pair }
  }

  try {
    const migrationOptions = {
      expected_migration_role: config.migrationRole,
      reader_role: config.readerRole,
      witness_acknowledgement_role: config.acknowledgementRole,
      expected_database: config.database,
      protected_journal_cluster_system_identifier: config.journalCluster,
      expected_witness_cluster_system_identifier: config.witnessCluster,
      encrypted_at_rest: true as const,
      restore_domain_sha256: restoreDomain,
      witness_identity_sha256: witnessIdentity,
      signer_principal: crypto.signer.signer_principal,
      signing_key_id: crypto.signer.signing_key_id,
      verification_key_sha256: crypto.signer.verification_key_sha256,
    }
    await applyPostgresDurableJournalWitnessMigrationV1(migration, migrationOptions)
    await applyPostgresDurableJournalWitnessMigrationV1(migration, migrationOptions)
    const first = await connect()
    const second = await connect()
    expect(first.witness.describe()).toEqual({
      durability: "durable",
      restore_domain_sha256: restoreDomain,
      witness_identity_sha256: witnessIdentity,
    })
    const journal = d("protected-disposable-task-journal")
    expect(await first.witness.readHead(journal)).toBeNull()

    const frontier1 = d("witness-frontier-1")
    const input1 = advance(journal, 0n, null, frontier1, "signed-anchor-1")
    const receipt1 = await first.witness.compareAndAdvance(input1)
    expect(receipt1).toMatchObject({ sequence: 1n, frontier_sha256: frontier1 })
    expect(receipt1.receipt_sha256).toBe(d(receipt1.canonical_receipt_bytes))
    const receiptRecord = parseCanonicalJson(new TextDecoder("utf-8", { fatal: true })
      .decode(receipt1.canonical_receipt_bytes)) as Record<string, unknown>
    expect(Object.keys(receiptRecord).sort()).toEqual([
      "expected_frontier_sha256", "expected_sequence", "frontier_sha256", "journal_identity_sha256",
      "restore_domain_sha256", "schema_version", "sequence", "signature_base64url",
      "signed_anchor_sha256", "signing_key_id",
      "witness_identity_sha256",
    ])
    expect(receiptRecord.expected_sequence).toBe(0n)
    expect(receiptRecord.expected_frontier_sha256).toBeNull()
    const signatureText = receiptRecord.signature_base64url
    expect(typeof signatureText).toBe("string")
    const signature = Uint8Array.from(Buffer.from(String(signatureText), "base64url"))
    expect(Buffer.from(signature).toString("base64url")).toBe(String(signatureText))
    const { signature_base64url: _signature, ...unsignedReceipt } = receiptRecord
    expect(crypto.verifier.verify(new TextEncoder().encode(canonicalJson(unsignedReceipt)), signature)).toBeTrue()
    const replay1 = await second.witness.compareAndAdvance(input1)
    expect(replay1).toEqual(receipt1)

    await expect(second.witness.compareAndAdvance({
      ...input1,
      successor_frontier_sha256: d("forked-frontier-1"),
    })).rejects.toMatchObject({ code: "integrity_failed" })
    await expect(first.witness.compareAndAdvance(
      advance(journal, 2n, d("imaginary-frontier-2"), d("imaginary-frontier-3"), "ahead-anchor"),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await expect(first.witness.compareAndAdvance({
      ...advance(d("invalid-genesis"), 0n, null, d("invalid-genesis-frontier"), "invalid-genesis-anchor"),
      expected_frontier_sha256: d("genesis-must-be-null"),
    })).rejects.toMatchObject({ code: "validation_failed" })
    await expect(first.witness.compareAndAdvance({
      ...advance(d("invalid-successor"), 1n, d("required-predecessor"), d("invalid-successor-frontier"),
        "invalid-successor-anchor"),
      expected_frontier_sha256: null,
    })).rejects.toMatchObject({ code: "validation_failed" })

    const frontier2 = d("witness-frontier-2")
    const input2 = advance(journal, 1n, frontier1, frontier2, "signed-anchor-2")
    const receipt2 = await first.witness.compareAndAdvance(input2)
    expect(receipt2.sequence).toBe(2n)
    await expect(second.witness.compareAndAdvance(input1)).rejects.toMatchObject({
      code: "integrity_failed",
    })

    const frontier3 = d("witness-frontier-3")
    const input3 = advance(journal, 2n, frontier2, frontier3, "signed-anchor-3")
    const [raceA, raceB] = await Promise.all([
      first.witness.compareAndAdvance(input3),
      second.witness.compareAndAdvance(input3),
    ])
    expect(raceA).toEqual(raceB)
    expect(raceA.sequence).toBe(3n)

    const input4a = advance(journal, 3n, frontier3, d("witness-frontier-4a"), "signed-anchor-4a")
    const input4b = advance(journal, 3n, frontier3, d("witness-frontier-4b"), "signed-anchor-4b")
    const conflictingRace = await Promise.allSettled([
      first.witness.compareAndAdvance(input4a),
      second.witness.compareAndAdvance(input4b),
    ])
    expect(conflictingRace.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(conflictingRace.filter((result) => result.status === "rejected")).toHaveLength(1)
    const rejected = conflictingRace.find((result) => result.status === "rejected")
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({
      code: "integrity_failed",
    })
    const head4 = await first.witness.readHead(journal)
    expect(head4?.sequence).toBe(4n)

    const restarted = await connect()
    expect(await restarted.witness.readHead(journal)).toEqual(head4)

    const migrationState = await migration.query<{ checksum_sha256: string }>(
      `SELECT checksum_sha256 FROM sandboxes_durable_journal_witness.schema_migrations
       WHERE migration_name = '0001_durable_journal_witness.sql'`,
    )
    expect(migrationState).toHaveLength(1)
    await migration.query(`ALTER FUNCTION sandboxes_durable_journal_witness.compare_and_advance(
      text,bigint,text,bigint,text,text,bytea,text) SET search_path = public`)
    const unsafeCatalogPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      unsafeCatalogPair.reader,
      options(unsafeCatalogPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query(`ALTER FUNCTION sandboxes_durable_journal_witness.compare_and_advance(
      text,bigint,text,bigint,text,text,bytea,text) SET search_path = pg_catalog`)

    await migration.query(`UPDATE sandboxes_durable_journal_witness.schema_migrations
      SET checksum_sha256 = $1 WHERE migration_name = '0001_durable_journal_witness.sql'`,
      [d("forged-migration-checksum")])
    const forgedMigrationPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      forgedMigrationPair.reader,
      options(forgedMigrationPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query(`UPDATE sandboxes_durable_journal_witness.schema_migrations
      SET checksum_sha256 = $1 WHERE migration_name = '0001_durable_journal_witness.sql'`,
      [migrationState[0]!.checksum_sha256])

    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts DISABLE TRIGGER receipts_immutable",
    )
    const disabledTriggerPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      disabledTriggerPair.reader,
      options(disabledTriggerPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts ENABLE TRIGGER receipts_immutable",
    )

    await migration.query(`ALTER TABLE sandboxes_durable_journal_witness.config
      ALTER COLUMN signer_principal TYPE varchar(128)`)
    const alteredColumnPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      alteredColumnPair.reader, options(alteredColumnPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query(`ALTER TABLE sandboxes_durable_journal_witness.config
      ALTER COLUMN signer_principal TYPE text`)

    await migration.query(`ALTER TABLE sandboxes_durable_journal_witness.config
      DROP CONSTRAINT config_encrypted_at_rest_check`)
    const droppedConstraintPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      droppedConstraintPair.reader, options(droppedConstraintPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query(`ALTER TABLE sandboxes_durable_journal_witness.config
      ADD CONSTRAINT config_encrypted_at_rest_check CHECK (encrypted_at_rest)`)

    await migration.query(`CREATE INDEX unexpected_receipt_recorded_at
      ON sandboxes_durable_journal_witness.receipts(recorded_at)`)
    const addedIndexPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      addedIndexPair.reader, options(addedIndexPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query("DROP INDEX sandboxes_durable_journal_witness.unexpected_receipt_recorded_at")

    await migration.query(`GRANT SELECT (signer_principal)
      ON sandboxes_durable_journal_witness.config TO ${config.acknowledgementRole}`)
    const columnGrantPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      columnGrantPair.reader, options(columnGrantPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query(`REVOKE SELECT (signer_principal)
      ON sandboxes_durable_journal_witness.config FROM ${config.acknowledgementRole}`)

    await migration.query("ALTER TABLE sandboxes_durable_journal_witness.config SET UNLOGGED")
    const unloggedPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      unloggedPair.reader, options(unloggedPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query("ALTER TABLE sandboxes_durable_journal_witness.config SET LOGGED")

    await expect(first.reader.query(
      `SELECT sandboxes_durable_journal_witness.compare_and_advance($1,0,NULL,1,$2,$3,$4,$5)`,
      [d("unauthorized-journal"), d("unauthorized-frontier"), d("unauthorized-anchor"),
        new Uint8Array([1]), d("unauthorized-receipt")],
    )).rejects.toBeDefined()
    await expect(first.acknowledgement.query(
      "SELECT * FROM sandboxes_durable_journal_witness.config",
    )).rejects.toBeDefined()
    await expect(first.reader.query(
      "UPDATE sandboxes_durable_journal_witness.heads SET head_sequence = head_sequence",
    )).rejects.toBeDefined()

    const currentReceipt = await migration.query<{
      canonical_receipt_bytes: Uint8Array
      receipt_sha256: string
      frontier_sha256: string
      signed_anchor_sha256: string
      prior_frontier_sha256: string
    }>(`SELECT canonical_receipt_bytes, receipt_sha256, frontier_sha256, signed_anchor_sha256,
        prior_frontier_sha256
      FROM sandboxes_durable_journal_witness.receipts
      WHERE journal_identity_sha256 = $1 AND sequence = 4`, [journal])
    expect(currentReceipt).toHaveLength(1)
    await expect(first.acknowledgement.query(
      `SELECT * FROM sandboxes_durable_journal_witness.compare_and_advance($1,$2,$3,$4,$5,$6,$7,$8)`,
      [journal, 3n, d("different-signed-predecessor"), 4n, currentReceipt[0]!.frontier_sha256,
        currentReceipt[0]!.signed_anchor_sha256, currentReceipt[0]!.canonical_receipt_bytes,
        currentReceipt[0]!.receipt_sha256],
    )).rejects.toBeDefined()
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts DISABLE TRIGGER receipts_immutable",
    )
    await migration.query(`UPDATE sandboxes_durable_journal_witness.receipts
      SET prior_frontier_sha256 = $1 WHERE journal_identity_sha256 = $2 AND sequence = 4`, [
      d("mutated-db-predecessor"), journal,
    ])
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts ENABLE TRIGGER receipts_immutable",
    )
    const predecessorCorruptPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      predecessorCorruptPair.reader,
      options(predecessorCorruptPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts DISABLE TRIGGER receipts_immutable",
    )
    await migration.query(`UPDATE sandboxes_durable_journal_witness.receipts
      SET prior_frontier_sha256 = $1 WHERE journal_identity_sha256 = $2 AND sequence = 4`, [
      currentReceipt[0]!.prior_frontier_sha256, journal,
    ])
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts ENABLE TRIGGER receipts_immutable",
    )
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts DISABLE TRIGGER receipts_immutable",
    )
    await migration.query(`UPDATE sandboxes_durable_journal_witness.receipts
      SET canonical_receipt_bytes = $1 WHERE journal_identity_sha256 = $2 AND sequence = 4`, [
      new Uint8Array([1, 2, 3]), journal,
    ])
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts ENABLE TRIGGER receipts_immutable",
    )
    const corruptPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      corruptPair.reader,
      options(corruptPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts DISABLE TRIGGER receipts_immutable",
    )
    await migration.query(`UPDATE sandboxes_durable_journal_witness.receipts
      SET canonical_receipt_bytes = $1 WHERE journal_identity_sha256 = $2 AND sequence = 4`, [
      currentReceipt[0]!.canonical_receipt_bytes, journal,
    ])
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts ENABLE TRIGGER receipts_immutable",
    )

    const receipt3 = await migration.query<{
      frontier_sha256: string; signed_anchor_sha256: string
      receipt_sha256: string; canonical_receipt_bytes: Uint8Array
    }>(`SELECT frontier_sha256, signed_anchor_sha256, receipt_sha256, canonical_receipt_bytes
      FROM sandboxes_durable_journal_witness.receipts
      WHERE journal_identity_sha256 = $1 AND sequence = 3`, [journal])
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.heads DISABLE TRIGGER heads_transition_guard",
    )
    await migration.query(`UPDATE sandboxes_durable_journal_witness.heads SET
      head_sequence = 3, head_frontier_sha256 = $1, head_signed_anchor_sha256 = $2,
      head_receipt_sha256 = $3, head_receipt_bytes = $4
      WHERE journal_identity_sha256 = $5`, [receipt3[0]!.frontier_sha256,
      receipt3[0]!.signed_anchor_sha256, receipt3[0]!.receipt_sha256,
      receipt3[0]!.canonical_receipt_bytes, journal])
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.heads ENABLE TRIGGER heads_transition_guard",
    )
    const rewindPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(
      rewindPair.reader,
      options(rewindPair.acknowledgement),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.heads DISABLE TRIGGER heads_transition_guard",
    )
    await migration.query(`UPDATE sandboxes_durable_journal_witness.heads SET
      head_sequence = 4, head_frontier_sha256 = $1, head_signed_anchor_sha256 = $2,
      head_receipt_sha256 = $3, head_receipt_bytes = $4
      WHERE journal_identity_sha256 = $5`, [currentReceipt[0]!.frontier_sha256,
      currentReceipt[0]!.signed_anchor_sha256, currentReceipt[0]!.receipt_sha256,
      currentReceipt[0]!.canonical_receipt_bytes, journal])
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.heads ENABLE TRIGGER heads_transition_guard",
    )

    // Rewinding the independent witness to a self-consistent predecessor cannot erase
    // the main journal's retained signed head/witness receipt. Composition fails closed.
    const mainKeys = generateKeyPairSync("ed25519")
    const mainCrypto = createEd25519DisposableTaskJournalCryptoV1({
      signer_principal: "service:main-disposable-journal",
      signing_key_id: "main-disposable-journal-key-v1",
      private_key: mainKeys.privateKey,
      public_key: mainKeys.publicKey,
    })
    const mainJournalIdentity = d("main-retained-journal-identity")
    const mainRestoreDomain = d("main-retained-journal-restore-domain")
    await applyPostgresDisposableTaskJournalMigrationV1(mainMigration, {
      expected_migration_role: config.mainMigrationRole,
      expected_database: config.mainDatabase,
      runtime_role: config.mainRuntimeRole,
      witness_acknowledgement_role: config.mainAckRole,
      journal_identity_sha256: mainJournalIdentity,
      restore_domain_sha256: mainRestoreDomain,
      external_head_witness_sha256: witnessIdentity,
      witness_verification_key_sha256: crypto.verifier.verification_key_sha256,
      signer_principal: mainCrypto.signer.signer_principal,
      signing_key_id: mainCrypto.signer.signing_key_id,
      verification_key_sha256: mainCrypto.signer.verification_key_sha256,
      encrypted_at_rest: true,
    })
    const mainRuntime = new Client(config.mainRuntimeUrl, config.ca)
    const mainAck = new Client(config.mainAckUrl, config.ca)
    mainClients.push(mainRuntime, mainAck)
    const mainOptions = {
      expected_migration_role: config.mainMigrationRole,
      expected_runtime_role: config.mainRuntimeRole,
      expected_database: config.mainDatabase,
      encrypted_at_rest: true as const,
      journal_identity_sha256: mainJournalIdentity,
      restore_domain_sha256: mainRestoreDomain,
      external_head_witness: first.witness,
      witness_receipt_verifier: {
        witness_identity_sha256: witnessIdentity,
        restore_domain_sha256: restoreDomain,
        signing_key_id: crypto.verifier.signing_key_id,
        verification_key_sha256: crypto.verifier.verification_key_sha256,
        verify: crypto.verifier.verify,
      },
      witness_acknowledgement_client: mainAck,
      expected_witness_acknowledgement_role: config.mainAckRole,
      ...mainCrypto,
    }
    const mainJournal = await PostgresDisposableTaskJournalV1.fromClient(mainRuntime, mainOptions)
    const mainPrepared = await mainJournal.prepareDispatch(mainPrepare("retained-head"))
    expect(mainPrepared.kind).toBe("prepared")
    const retained = await mainMigration.query<{
      head_sequence: bigint | string; witnessed_sequence: bigint | string
      head_frontier_sha256: string; witnessed_frontier_sha256: string
      witness_receipt_bytes: Uint8Array; witness_receipt_sha256: string
    }>(`SELECT head_sequence, witnessed_sequence, head_frontier_sha256,
        witnessed_frontier_sha256, witness_receipt_bytes, witness_receipt_sha256
      FROM sandboxes_disposable_task_journal.store WHERE singleton`)
    expect(retained).toHaveLength(1)
    expect(BigInt(retained[0]!.head_sequence)).toBe(1n)
    expect(BigInt(retained[0]!.witnessed_sequence)).toBe(1n)
    expect(retained[0]!.witnessed_frontier_sha256).toBe(retained[0]!.head_frontier_sha256)
    expect(d(retained[0]!.witness_receipt_bytes)).toBe(retained[0]!.witness_receipt_sha256 as Digest)
    expect((await first.witness.readHead(mainJournalIdentity))?.sequence).toBe(1n)

    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.heads DISABLE TRIGGER heads_transition_guard",
    )
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts DISABLE TRIGGER receipts_immutable",
    )
    await migration.query(
      "DELETE FROM sandboxes_durable_journal_witness.heads WHERE journal_identity_sha256 = $1",
      [mainJournalIdentity],
    )
    await migration.query(
      "DELETE FROM sandboxes_durable_journal_witness.receipts WHERE journal_identity_sha256 = $1 AND sequence = 1",
      [mainJournalIdentity],
    )
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.receipts ENABLE TRIGGER receipts_immutable",
    )
    await migration.query(
      "ALTER TABLE sandboxes_durable_journal_witness.heads ENABLE TRIGGER heads_transition_guard",
    )
    const rewoundWitness = await connect()
    expect(await rewoundWitness.witness.readHead(mainJournalIdentity)).toBeNull()
    const reopenRuntime = new Client(config.mainRuntimeUrl, config.ca)
    const reopenAck = new Client(config.mainAckUrl, config.ca)
    mainClients.push(reopenRuntime, reopenAck)
    await expect(PostgresDisposableTaskJournalV1.fromClient(reopenRuntime, {
      ...mainOptions,
      external_head_witness: rewoundWitness.witness,
      witness_acknowledgement_client: reopenAck,
    })).rejects.toMatchObject({ code: "integrity_failed" })

    const wrongKeys = generateKeyPairSync("ed25519")
    const wrongCrypto = createEd25519DurableJournalWitnessCryptoV1({
      signer_principal: crypto.signer.signer_principal,
      signing_key_id: crypto.signer.signing_key_id,
      private_key: wrongKeys.privateKey,
      public_key: wrongKeys.publicKey,
    })
    const wrongKeyPair = newClients()
    await expect(PostgresDurableJournalWitnessV1.fromClients(wrongKeyPair.reader,
      options(wrongKeyPair.acknowledgement, {
        signer: wrongCrypto.signer,
        verifier: wrongCrypto.verifier,
      }))).rejects.toMatchObject({ code: "integrity_failed" })
  } finally {
    for (const witness of opened) await witness.close().catch(() => undefined)
    await Promise.allSettled(clients.map((client) => client.close()))
    await Promise.allSettled(mainClients.map((client) => client.close()))
    await mainMigration.close()
    await migration.close()
  }
})
