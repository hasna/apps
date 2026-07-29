import { SQL } from "bun"
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { canonicalJson, isDigest, parseCanonicalJson } from "./canonical"
import { adapterError, type AdapterContractError } from "./errors"
import type {
  DurableJournalWitnessPortV1,
  DurableJournalWitnessReceiptV1,
} from "./disposable-task"
import type { Digest } from "./types"
import {
  assertPostgresClientV1,
  assertPostgresSessionV1,
  type PostgresClientV1,
  type PostgresSessionV1,
} from "./postgres-client"

const SCHEMA = "sandboxes_durable_journal_witness"
const MIGRATION_NAME = "0001_durable_journal_witness.sql"
const MIGRATION_SHA256 = "sha256:0fae616257640725681d9b364f40d75f4b53ba22f1993e21609f470eef3883cd" as const
const RECEIPT_SCHEMA_VERSION = "sandboxes.durable-journal-witness-receipt/v1" as const
const SAFE_ROLE = /^[a-z_][a-z0-9_]{0,62}$/u
const SAFE_DATABASE = /^[a-z_][a-z0-9_]{0,62}$/u
const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const CLUSTER_SYSTEM_IDENTIFIER = /^[1-9][0-9]{0,31}$/u
const MAX_RECEIPT_BYTES = 64 * 1024
const MAX_ANCHOR_BYTES = 2 * 1024 * 1024
const EXPECTED_TABLES = ["config", "heads", "receipts", "schema_migrations"] as const
const EXPECTED_FUNCTIONS = [
  "compare_and_advance(text, bigint, text, bigint, text, text, bytea, text)",
  "reject_mutation()",
  "validate_head_transition()",
] as const
const CATALOG_COLUMNS_SHA256 =
  "sha256:9b380ce150f1999c8ac0ca7dcd96603beb51f6ac9f7dcdb0b6191c8737fd6f5c" as const
const CATALOG_CONSTRAINTS_SHA256 =
  "sha256:b63400474d120eb5ad3888fd679743fa05d34f6577b2c0767967d02ead3bf61e" as const
const CATALOG_INDEXES_SHA256 =
  "sha256:26580f625a10877023573ca8f16eacf44bc58d4796a820b3857f04e4b66fab74" as const
const FUNCTION_DEFINITION_SHA256: Readonly<Record<string, Digest>> = Object.freeze({
  "compare_and_advance(text, bigint, text, bigint, text, text, bytea, text)":
    "sha256:47cf996daba2dd4bfe81a3b30c6ddd0dbda826550acc06f5f591928249fc0eab",
  "reject_mutation()": "sha256:92cc6753ed509e677f23e53214438706ed4a05c46e896b3897453e7ff911341d",
  "validate_head_transition()": "sha256:9bf62dae6a2d5efb39b63ff72a273ed07e4cf6d87b82eec9c23e26305b780757",
})
const TRIGGER_DEFINITION_SHA256: Readonly<Record<string, Digest>> = Object.freeze({
  config_immutable: "sha256:c11052ed93af994ca4c6717035bc2d8f2f672b1a87b7af8fe7f6cb4f81c3ee6d",
  heads_transition_guard: "sha256:53769677f486c135558e4df90fd860869ffe9c0c08dfbfa61689da0110a49b26",
  receipts_immutable: "sha256:f2e816ab675b9d7c4daf82b347aa56247172f3014b19792623bc9ca78b764740",
})

export interface DurableJournalWitnessSignerV1 {
  readonly signer_principal: string
  readonly signing_key_id: string
  readonly verification_key_sha256: Digest
  sign(bytes: Uint8Array): Uint8Array
}

export interface DurableJournalWitnessSignatureVerifierV1 {
  readonly signer_principal: string
  readonly signing_key_id: string
  readonly verification_key_sha256: Digest
  verify(bytes: Uint8Array, signature: Uint8Array): boolean
}

export interface PostgresDurableJournalWitnessOptionsV1 {
  readonly expected_migration_role: string
  readonly expected_reader_role: string
  readonly expected_witness_acknowledgement_role: string
  readonly expected_database: string
  readonly protected_journal_cluster_system_identifier: string
  readonly expected_witness_cluster_system_identifier: string
  readonly encrypted_at_rest: true
  readonly restore_domain_sha256: Digest
  readonly witness_identity_sha256: Digest
  readonly signer: DurableJournalWitnessSignerV1
  readonly verifier: DurableJournalWitnessSignatureVerifierV1
  /** A distinct least-privilege session that can only invoke compare_and_advance. */
  readonly witness_acknowledgement_client: PostgresClientV1
}

export interface PostgresDurableJournalWitnessMigrationOptionsV1 {
  readonly expected_migration_role: string
  readonly reader_role: string
  readonly witness_acknowledgement_role: string
  readonly expected_database: string
  readonly protected_journal_cluster_system_identifier: string
  readonly expected_witness_cluster_system_identifier: string
  readonly encrypted_at_rest: true
  readonly restore_domain_sha256: Digest
  readonly witness_identity_sha256: Digest
  readonly signer_principal: string
  readonly signing_key_id: string
  readonly verification_key_sha256: Digest
}

interface ConfigRow extends Record<string, unknown> {
  protected_journal_cluster_system_identifier: string
  witness_cluster_system_identifier: string
  witness_database_name: string
  witness_database_oid: bigint | number | string
  restore_domain_sha256: string
  witness_identity_sha256: string
  signer_principal: string
  signing_key_id: string
  verification_key_sha256: string
  encrypted_at_rest: boolean
}

interface ReceiptRow extends Record<string, unknown> {
  journal_identity_sha256: string
  sequence: bigint | number | string
  prior_frontier_sha256: string | null
  frontier_sha256: string
  signed_anchor_sha256: string
  canonical_receipt_bytes: Uint8Array
  receipt_sha256: string
}

interface HeadRow extends Record<string, unknown> {
  journal_identity_sha256: string
  head_sequence: bigint | number | string
  head_frontier_sha256: string
  head_signed_anchor_sha256: string
  head_receipt_sha256: string
  head_receipt_bytes: Uint8Array
}

interface HeadReadRow extends Record<string, unknown> {
  journal_identity_sha256: string | null
  head_sequence: bigint | number | string | null
  head_frontier_sha256: string | null
  head_signed_anchor_sha256: string | null
  head_receipt_sha256: string | null
  head_receipt_bytes: Uint8Array | null
  receipt_count: bigint | number | string
  latest_sequence: bigint | number | string | null
  prior_frontier_sha256: string | null
}

interface SessionIdentity extends Record<string, unknown> {
  session_user: string
  current_user: string
  current_database: string
  database_oid: bigint | number | string
  cluster_system_identifier: string
  ssl_in_use: boolean
  can_create_database: boolean
  can_create_temporary: boolean
  database_owner_member: boolean
  is_superuser: boolean
  can_create_db_role: boolean
  can_create_role: boolean
  can_replicate: boolean
  can_bypass_rls: boolean
  parent_memberships: bigint | number | string
  settable_memberships: bigint | number | string
}

interface BunSqlLike {
  unsafe(statement: string, parameters?: unknown[]): Promise<unknown[]>
  begin<T>(fn: (transaction: BunSqlLike) => Promise<T>): Promise<T>
  close(options?: { timeout?: number }): Promise<void>
}

class BunWitnessSession implements PostgresSessionV1 {
  constructor(readonly sql: BunSqlLike) {}
  async query<Row extends Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<Row[]> {
    return await this.sql.unsafe(statement, [...parameters]) as Row[]
  }
}

class BunWitnessClient extends BunWitnessSession implements PostgresClientV1 {
  async transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    return await this.sql.begin(async (transaction) => fn(new BunWitnessSession(transaction)))
  }
  async close(): Promise<void> {
    await this.sql.close({ timeout: 0 })
  }
}

function digestBytes(value: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function asBytes(value: unknown, maximum = MAX_RECEIPT_BYTES): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maximum) {
    throw adapterError("integrity_failed")
  }
  return Uint8Array.from(value)
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right))
}

function dbBigint(value: unknown): bigint {
  try {
    if (typeof value === "bigint") return value
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value)
    if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) return BigInt(value)
  } catch {
    // Converted to the single fail-closed error below.
  }
  throw adapterError("integrity_failed")
}

function assertDigest(value: unknown): asserts value is Digest {
  if (!isDigest(value)) throw adapterError("validation_failed")
}

function assertText(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SAFE_TEXT.test(value)) throw adapterError("validation_failed")
}

function assertClusterIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !CLUSTER_SYSTEM_IDENTIFIER.test(value)) {
    throw adapterError("validation_failed")
  }
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  try {
    const actual = Reflect.ownKeys(value)
    return actual.length === keys.length && actual.every((key) => {
      if (typeof key !== "string" || !keys.includes(key)) return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor?.enumerable === true && "value" in descriptor
    })
  } catch {
    return false
  }
}

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
}

function parseCanonicalReceipt(value: Uint8Array): Record<string, unknown> {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(value)
    const parsed = parseCanonicalJson(text)
    if (bytes(canonicalJson(parsed)).byteLength !== value.byteLength ||
      !byteEqual(bytes(canonicalJson(parsed)), value) || parsed === null || typeof parsed !== "object" ||
      Array.isArray(parsed)) throw adapterError("integrity_failed")
    return parsed as Record<string, unknown>
  } catch (error) {
    if (isAdapterError(error)) throw error
    throw adapterError("integrity_failed")
  }
}

function isAdapterError(value: unknown): value is AdapterContractError {
  return value instanceof Error && value.name === "AdapterContractError" &&
    typeof (value as { code?: unknown }).code === "string"
}

function packageRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as unknown
      if (manifest !== null && typeof manifest === "object" && !Array.isArray(manifest) &&
        (manifest as Record<string, unknown>).name === "@hasna/sandboxes") return current
    } catch (error) {
      const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined
      if (code !== "ENOENT") throw adapterError("integrity_failed")
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw adapterError("integrity_failed")
}

export function loadPostgresDurableJournalWitnessMigrationSourceV1(): string {
  const source = readFileSync(join(packageRoot(), "migrations/durable-journal-witness", MIGRATION_NAME), "utf8")
  if (digestBytes(bytes(source)) !== MIGRATION_SHA256) throw adapterError("integrity_failed")
  return source
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function validateRoleConfiguration(
  migrationRole: string,
  readerRole: string,
  acknowledgementRole: string,
  database: string,
): void {
  if (![migrationRole, readerRole, acknowledgementRole].every((role) => SAFE_ROLE.test(role)) ||
    new Set([migrationRole, readerRole, acknowledgementRole]).size !== 3 ||
    !SAFE_DATABASE.test(database)) throw adapterError("validation_failed")
}

async function sessionIdentity(client: PostgresClientV1): Promise<SessionIdentity> {
  assertPostgresClientV1(client, "durable journal witness identity check")
  const rows = await client.query<SessionIdentity>(`
    SELECT session_user::text AS session_user, current_user::text AS current_user,
      current_database()::text AS current_database,
      database.oid::bigint AS database_oid,
      control.system_identifier::text AS cluster_system_identifier,
      COALESCE((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl_in_use,
      has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database,
      has_database_privilege(current_user, current_database(), 'TEMPORARY') AS can_create_temporary,
      pg_has_role(current_user, 'pg_database_owner', 'MEMBER') AS database_owner_member,
      role.rolsuper AS is_superuser, role.rolcreatedb AS can_create_db_role,
      role.rolcreaterole AS can_create_role, role.rolreplication AS can_replicate,
      role.rolbypassrls AS can_bypass_rls,
      (SELECT count(*) FROM pg_catalog.pg_auth_members membership
        WHERE membership.member = role.oid) AS parent_memberships,
      (SELECT count(*) FROM pg_catalog.pg_auth_members membership
        WHERE membership.member = role.oid AND membership.set_option) AS settable_memberships
    FROM pg_catalog.pg_roles role
    JOIN pg_catalog.pg_database database ON database.datname = current_database()
    CROSS JOIN pg_catalog.pg_control_system() control
    WHERE role.rolname = current_user
  `)
  if (rows.length !== 1) throw adapterError("integrity_failed")
  return rows[0]!
}

function assertRestrictedIdentity(
  identity: SessionIdentity,
  role: string,
  database: string,
  clusterSystemIdentifier: string,
): void {
  if (identity.session_user !== role || identity.current_user !== role ||
    identity.current_database !== database ||
    identity.cluster_system_identifier !== clusterSystemIdentifier || identity.ssl_in_use !== true ||
    identity.can_create_database || identity.can_create_temporary || identity.database_owner_member ||
    identity.is_superuser || identity.can_create_db_role || identity.can_create_role ||
    identity.can_replicate || identity.can_bypass_rls || dbBigint(identity.parent_memberships) !== 0n ||
    dbBigint(identity.settable_memberships) !== 0n) throw adapterError("integrity_failed")
}

function validateSignerPair(
  signer: DurableJournalWitnessSignerV1,
  verifier: DurableJournalWitnessSignatureVerifierV1,
): void {
  assertText(signer.signer_principal)
  assertText(signer.signing_key_id)
  assertDigest(signer.verification_key_sha256)
  if (signer.signer_principal !== verifier.signer_principal ||
    signer.signing_key_id !== verifier.signing_key_id ||
    signer.verification_key_sha256 !== verifier.verification_key_sha256) {
    throw adapterError("integrity_failed")
  }
  const challenge = bytes(canonicalJson({ domain: "sandboxes.durable-journal-witness.key-possession/v1" }))
  const signature = signer.sign(challenge)
  if (!(signature instanceof Uint8Array) || signature.byteLength !== 64 ||
    !verifier.verify(challenge, signature)) throw adapterError("integrity_failed")
}

export function createEd25519DurableJournalWitnessCryptoV1(input: Readonly<{
  signer_principal: string
  signing_key_id: string
  private_key: KeyObject | string | Uint8Array
  public_key?: KeyObject | string | Uint8Array
}>): {
  signer: DurableJournalWitnessSignerV1
  verifier: DurableJournalWitnessSignatureVerifierV1
} {
  assertText(input.signer_principal)
  assertText(input.signing_key_id)
  const privateKey = input.private_key instanceof KeyObject
    ? input.private_key
    : createPrivateKey(input.private_key)
  const publicKey = input.public_key === undefined
    ? createPublicKey(privateKey.export({ type: "pkcs8", format: "pem" }))
    : input.public_key instanceof KeyObject
      ? input.public_key
      : createPublicKey(input.public_key)
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") {
    throw adapterError("validation_failed")
  }
  const verificationKeySha256 = digestBytes(
    Uint8Array.from(publicKey.export({ type: "spki", format: "der" })),
  )
  return Object.freeze({
    signer: Object.freeze({
      signer_principal: input.signer_principal,
      signing_key_id: input.signing_key_id,
      verification_key_sha256: verificationKeySha256,
      sign: (message: Uint8Array) => Uint8Array.from(cryptoSign(null, message, privateKey)),
    }),
    verifier: Object.freeze({
      signer_principal: input.signer_principal,
      signing_key_id: input.signing_key_id,
      verification_key_sha256: verificationKeySha256,
      verify: (message: Uint8Array, signature: Uint8Array) =>
        cryptoVerify(null, message, publicKey, signature),
    }),
  })
}

export async function applyPostgresDurableJournalWitnessMigrationV1(
  client: PostgresClientV1,
  options: PostgresDurableJournalWitnessMigrationOptionsV1,
): Promise<void> {
  validateRoleConfiguration(options.expected_migration_role, options.reader_role,
    options.witness_acknowledgement_role, options.expected_database)
  if (options.encrypted_at_rest !== true) throw adapterError("validation_failed")
  assertClusterIdentifier(options.protected_journal_cluster_system_identifier)
  assertClusterIdentifier(options.expected_witness_cluster_system_identifier)
  if (options.protected_journal_cluster_system_identifier ===
    options.expected_witness_cluster_system_identifier) throw adapterError("validation_failed")
  for (const digest of [options.restore_domain_sha256, options.witness_identity_sha256,
    options.verification_key_sha256]) assertDigest(digest)
  assertText(options.signer_principal)
  assertText(options.signing_key_id)

  const identity = await sessionIdentity(client)
  if (identity.session_user !== options.expected_migration_role ||
    identity.current_user !== options.expected_migration_role ||
    identity.current_database !== options.expected_database || identity.ssl_in_use !== true ||
    identity.cluster_system_identifier !== options.expected_witness_cluster_system_identifier) {
    throw adapterError("integrity_failed")
  }
  const owner = await client.query<{ owner: string }>(`
    SELECT owner.rolname::text AS owner FROM pg_catalog.pg_database database
    JOIN pg_catalog.pg_roles owner ON owner.oid = database.datdba
    WHERE database.datname = current_database()
  `)
  if (owner.length !== 1 || owner[0]!.owner !== options.expected_migration_role) {
    throw adapterError("integrity_failed")
  }

  const source = loadPostgresDurableJournalWitnessMigrationSourceV1()
  const checkedMigrations = [{
    name: MIGRATION_NAME,
    checksum: MIGRATION_SHA256,
    source,
  }] as const
  const reader = quoteIdentifier(options.reader_role)
  const acknowledgement = quoteIdentifier(options.witness_acknowledgement_role)
  const database = quoteIdentifier(options.expected_database)

  await client.transaction(async (session) => {
    assertPostgresSessionV1(session, "durable journal witness migration transaction")
    await session.query("SELECT pg_advisory_xact_lock(36711471343122011)")
    await session.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
    await session.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (
      migration_name text PRIMARY KEY, checksum_sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`)
    const applied = await session.query<{ migration_name: string; checksum_sha256: string }>(
      `SELECT migration_name, checksum_sha256
        FROM ${SCHEMA}.schema_migrations ORDER BY migration_name`,
    )
    if (applied.length > checkedMigrations.length || applied.some((migration, index) =>
      migration.migration_name !== checkedMigrations[index]?.name ||
      migration.checksum_sha256 !== checkedMigrations[index]?.checksum)) {
      throw adapterError("integrity_failed")
    }
    for (const migration of checkedMigrations.slice(applied.length)) {
      await session.query(migration.source)
      await session.query(
        `INSERT INTO ${SCHEMA}.schema_migrations(migration_name, checksum_sha256) VALUES ($1,$2)`,
        [migration.name, migration.checksum],
      )
    }
    const config = await session.query<ConfigRow>(`SELECT * FROM ${SCHEMA}.config WHERE singleton FOR UPDATE`)
    if (config.length === 0) {
      await session.query(`INSERT INTO ${SCHEMA}.config (
        singleton, protected_journal_cluster_system_identifier,
        witness_cluster_system_identifier, witness_database_name, witness_database_oid,
        restore_domain_sha256, witness_identity_sha256, signer_principal,
        signing_key_id, verification_key_sha256, encrypted_at_rest
      ) VALUES (true,$1,$2,$3,$4,$5,$6,$7,$8,$9,true)`, [
        options.protected_journal_cluster_system_identifier,
        options.expected_witness_cluster_system_identifier,
        options.expected_database,
        dbBigint(identity.database_oid),
        options.restore_domain_sha256,
        options.witness_identity_sha256,
        options.signer_principal,
        options.signing_key_id,
        options.verification_key_sha256,
      ])
    } else if (config.length !== 1 ||
      config[0]!.protected_journal_cluster_system_identifier !==
        options.protected_journal_cluster_system_identifier ||
      config[0]!.witness_cluster_system_identifier !== options.expected_witness_cluster_system_identifier ||
      config[0]!.witness_database_name !== options.expected_database ||
      dbBigint(config[0]!.witness_database_oid) !== dbBigint(identity.database_oid) ||
      config[0]!.restore_domain_sha256 !== options.restore_domain_sha256 ||
      config[0]!.witness_identity_sha256 !== options.witness_identity_sha256 ||
      config[0]!.signer_principal !== options.signer_principal ||
      config[0]!.signing_key_id !== options.signing_key_id ||
      config[0]!.verification_key_sha256 !== options.verification_key_sha256 ||
      config[0]!.encrypted_at_rest !== true) throw adapterError("integrity_failed")

    await session.query(`REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE ${database} FROM PUBLIC`)
    await session.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${reader}, ${acknowledgement} CASCADE`)
    await session.query(`REVOKE ALL ON SCHEMA ${SCHEMA} FROM PUBLIC, ${reader}, ${acknowledgement}`)
    await session.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${SCHEMA} FROM PUBLIC, ${reader}, ${acknowledgement}`)
    await session.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA ${SCHEMA} FROM PUBLIC, ${reader}, ${acknowledgement}`)
    await session.query(`GRANT CONNECT ON DATABASE ${database} TO ${reader}, ${acknowledgement}`)
    await session.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${reader}, ${acknowledgement}`)
    await session.query(`GRANT SELECT ON ${SCHEMA}.config, ${SCHEMA}.receipts, ${SCHEMA}.heads,
      ${SCHEMA}.schema_migrations TO ${reader}`)
    await session.query(`GRANT EXECUTE ON FUNCTION ${SCHEMA}.compare_and_advance(text,bigint,text,bigint,text,text,bytea,text) TO ${acknowledgement}`)
  })
}

/**
 * Independent opaque-anchor CAS witness. It signs and linearizes the exact anchor digest and
 * predecessor chain; the protected journal remains responsible for parsing and verifying its
 * own anchor schema and journal signature before submitting or accepting witnessed evidence.
 */
export class PostgresDurableJournalWitnessV1 implements DurableJournalWitnessPortV1 {
  readonly #reader: PostgresClientV1
  readonly #acknowledgement: PostgresClientV1
  readonly #options: PostgresDurableJournalWitnessOptionsV1
  #ready = false

  private constructor(reader: PostgresClientV1, options: PostgresDurableJournalWitnessOptionsV1) {
    this.#reader = reader
    this.#acknowledgement = options.witness_acknowledgement_client
    this.#options = options
  }

  static async connect(
    readerUrl: string,
    acknowledgementUrl: string,
    tlsCa: string | Uint8Array,
    options: Omit<PostgresDurableJournalWitnessOptionsV1, "witness_acknowledgement_client">,
  ): Promise<PostgresDurableJournalWitnessV1> {
    const reader = this.#connectClient(readerUrl, tlsCa)
    const acknowledgement = this.#connectClient(acknowledgementUrl, tlsCa)
    try {
      return await this.fromClients(reader, { ...options, witness_acknowledgement_client: acknowledgement })
    } catch (error) {
      await Promise.allSettled([reader.close(), acknowledgement.close()])
      throw error
    }
  }

  static async fromClients(
    reader: PostgresClientV1,
    options: PostgresDurableJournalWitnessOptionsV1,
  ): Promise<PostgresDurableJournalWitnessV1> {
    if (reader === options.witness_acknowledgement_client || options.encrypted_at_rest !== true) {
      throw adapterError("validation_failed")
    }
    validateRoleConfiguration(options.expected_migration_role, options.expected_reader_role,
      options.expected_witness_acknowledgement_role, options.expected_database)
    assertClusterIdentifier(options.protected_journal_cluster_system_identifier)
    assertClusterIdentifier(options.expected_witness_cluster_system_identifier)
    if (options.protected_journal_cluster_system_identifier ===
      options.expected_witness_cluster_system_identifier) throw adapterError("validation_failed")
    assertDigest(options.restore_domain_sha256)
    assertDigest(options.witness_identity_sha256)
    validateSignerPair(options.signer, options.verifier)
    const witness = new PostgresDurableJournalWitnessV1(reader, options)
    try {
      await witness.#initialize()
      witness.#ready = true
      return witness
    } catch (error) {
      if (isAdapterError(error)) throw error
      throw adapterError("dependency_unavailable", { retryable: true, cause: error })
    }
  }

  static #connectClient(url: string, tlsCa: string | Uint8Array): PostgresClientV1 {
    const parsed = new URL(url)
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      parsed.searchParams.get("sslmode") !== "verify-full") throw adapterError("validation_failed")
    const sql = new SQL({
      url,
      max: 1,
      connectionTimeout: 10,
      tls: { ca: tlsCa, serverName: parsed.hostname, rejectUnauthorized: true },
    }) as unknown as BunSqlLike
    return new BunWitnessClient(sql)
  }

  describe() {
    return Object.freeze({
      durability: "durable" as const,
      restore_domain_sha256: this.#options.restore_domain_sha256,
      witness_identity_sha256: this.#options.witness_identity_sha256,
    })
  }

  async readHead(journalIdentitySha256: Digest): Promise<DurableJournalWitnessReceiptV1 | null> {
    this.#requireReady()
    assertDigest(journalIdentitySha256)
    let rows: HeadReadRow[]
    try {
      rows = await this.#reader.query<HeadReadRow>(
        `WITH receipt_stats AS (
          SELECT count(*) AS receipt_count, max(sequence) AS latest_sequence
          FROM ${SCHEMA}.receipts WHERE journal_identity_sha256 = $1
        ) SELECT head.journal_identity_sha256, head.head_sequence,
          head.head_frontier_sha256, head.head_signed_anchor_sha256,
          head.head_receipt_sha256, head.head_receipt_bytes,
          receipt_stats.receipt_count, receipt_stats.latest_sequence,
          receipt.prior_frontier_sha256
        FROM receipt_stats LEFT JOIN ${SCHEMA}.heads head
          ON head.journal_identity_sha256 = $1
        LEFT JOIN ${SCHEMA}.receipts receipt
          ON receipt.journal_identity_sha256 = head.journal_identity_sha256
          AND receipt.sequence = head.head_sequence`,
        [journalIdentitySha256],
      )
    } catch (error) {
      throw adapterError("dependency_unavailable", { retryable: true, cause: error })
    }
    if (rows.length !== 1) throw adapterError("integrity_failed")
    const row = rows[0]!
    const count = dbBigint(row.receipt_count)
    if (count === 0n) {
      if (row.journal_identity_sha256 !== null || row.latest_sequence !== null) {
        throw adapterError("integrity_failed")
      }
      return null
    }
    if (row.journal_identity_sha256 !== journalIdentitySha256 || row.head_sequence === null ||
      row.head_frontier_sha256 === null || row.head_signed_anchor_sha256 === null ||
      row.head_receipt_sha256 === null || row.head_receipt_bytes === null ||
      row.latest_sequence === null || dbBigint(row.latest_sequence) !== dbBigint(row.head_sequence) ||
      count !== dbBigint(row.head_sequence)) {
      throw adapterError("integrity_failed")
    }
    return this.#verifyReceipt({
      journal_identity_sha256: row.journal_identity_sha256,
      sequence: row.head_sequence,
      prior_frontier_sha256: row.prior_frontier_sha256,
      frontier_sha256: row.head_frontier_sha256,
      signed_anchor_sha256: row.head_signed_anchor_sha256,
      canonical_receipt_bytes: row.head_receipt_bytes,
      receipt_sha256: row.head_receipt_sha256,
    })
  }

  async compareAndAdvance(input: Readonly<{
    journal_identity_sha256: Digest
    expected_sequence: bigint
    expected_frontier_sha256: Digest | null
    successor_sequence: bigint
    successor_frontier_sha256: Digest
    signed_anchor_bytes: Uint8Array
  }>): Promise<DurableJournalWitnessReceiptV1> {
    this.#requireReady()
    if (input === null || typeof input !== "object" || !exactKeys(input, [
      "journal_identity_sha256", "expected_sequence", "expected_frontier_sha256",
      "successor_sequence", "successor_frontier_sha256", "signed_anchor_bytes",
    ])) throw adapterError("validation_failed")
    assertDigest(input.journal_identity_sha256)
    assertDigest(input.successor_frontier_sha256)
    if (input.expected_frontier_sha256 !== null) assertDigest(input.expected_frontier_sha256)
    if (typeof input.expected_sequence !== "bigint" || input.expected_sequence < 0n ||
      typeof input.successor_sequence !== "bigint" ||
      input.successor_sequence !== input.expected_sequence + 1n ||
      ((input.expected_sequence === 0n) !== (input.expected_frontier_sha256 === null))) {
      throw adapterError("validation_failed")
    }
    const anchorBytes = asBytes(input.signed_anchor_bytes, MAX_ANCHOR_BYTES)
    const anchorSha256 = digestBytes(anchorBytes)
    const unsigned = {
      schema_version: RECEIPT_SCHEMA_VERSION,
      witness_identity_sha256: this.#options.witness_identity_sha256,
      restore_domain_sha256: this.#options.restore_domain_sha256,
      journal_identity_sha256: input.journal_identity_sha256,
      expected_sequence: input.expected_sequence,
      expected_frontier_sha256: input.expected_frontier_sha256,
      sequence: input.successor_sequence,
      frontier_sha256: input.successor_frontier_sha256,
      signed_anchor_sha256: anchorSha256,
      signing_key_id: this.#options.signer.signing_key_id,
    }
    const unsignedBytes = bytes(canonicalJson(unsigned))
    const signature = this.#options.signer.sign(unsignedBytes)
    if (!(signature instanceof Uint8Array) || signature.byteLength !== 64 ||
      !this.#options.verifier.verify(unsignedBytes, signature)) throw adapterError("integrity_failed")
    const receiptBytes = bytes(canonicalJson({
      ...unsigned,
      signature_base64url: Buffer.from(signature).toString("base64url"),
    }))
    const receiptSha256 = digestBytes(receiptBytes)

    let rows: Array<Record<string, unknown>>
    try {
      rows = await this.#acknowledgement.query(
        `SELECT * FROM ${SCHEMA}.compare_and_advance($1,$2,$3,$4,$5,$6,$7,$8)`,
        [input.journal_identity_sha256, input.expected_sequence, input.expected_frontier_sha256,
          input.successor_sequence, input.successor_frontier_sha256, anchorSha256,
          receiptBytes, receiptSha256],
      )
    } catch (error) {
      const state = error !== null && typeof error === "object"
        ? (error as { errno?: unknown }).errno : undefined
      if (["22023", "23514", "40001", "55000"].includes(String(state))) {
        throw adapterError("integrity_failed", { cause: error })
      }
      throw adapterError("dependency_unavailable", { retryable: true, cause: error })
    }
    if (rows.length !== 1) throw adapterError("integrity_failed")
    const row = rows[0]!
    const verified = this.#verifyReceipt({
      journal_identity_sha256: input.journal_identity_sha256,
      sequence: row.sequence,
      prior_frontier_sha256: row.prior_frontier_sha256,
      frontier_sha256: String(row.frontier_sha256),
      signed_anchor_sha256: anchorSha256,
      canonical_receipt_bytes: row.canonical_receipt_bytes as Uint8Array,
      receipt_sha256: String(row.receipt_sha256),
    })
    if (verified.sequence !== input.successor_sequence ||
      verified.frontier_sha256 !== input.successor_frontier_sha256 ||
      verified.receipt_sha256 !== receiptSha256 ||
      !byteEqual(verified.canonical_receipt_bytes, receiptBytes)) throw adapterError("integrity_failed")
    return verified
  }

  async close(): Promise<void> {
    this.#ready = false
    await Promise.all([this.#reader.close(), this.#acknowledgement.close()]).then(() => undefined)
  }

  async #initialize(): Promise<void> {
    const [readerIdentity, acknowledgementIdentity] = await Promise.all([
      sessionIdentity(this.#reader), sessionIdentity(this.#acknowledgement),
    ])
    assertRestrictedIdentity(readerIdentity, this.#options.expected_reader_role,
      this.#options.expected_database, this.#options.expected_witness_cluster_system_identifier)
    assertRestrictedIdentity(acknowledgementIdentity, this.#options.expected_witness_acknowledgement_role,
      this.#options.expected_database, this.#options.expected_witness_cluster_system_identifier)
    if (dbBigint(readerIdentity.database_oid) !== dbBigint(acknowledgementIdentity.database_oid)) {
      throw adapterError("integrity_failed")
    }
    await this.#verifyCatalog()
    await this.#verifyPrivileges()
    const configs = await this.#reader.query<ConfigRow>(`SELECT * FROM ${SCHEMA}.config WHERE singleton`)
    if (configs.length !== 1) throw adapterError("integrity_failed")
    const config = configs[0]!
    if (config.protected_journal_cluster_system_identifier !==
      this.#options.protected_journal_cluster_system_identifier ||
      config.witness_cluster_system_identifier !== this.#options.expected_witness_cluster_system_identifier ||
      config.witness_database_name !== this.#options.expected_database ||
      dbBigint(config.witness_database_oid) !== dbBigint(readerIdentity.database_oid) ||
      config.restore_domain_sha256 !== this.#options.restore_domain_sha256 ||
      config.witness_identity_sha256 !== this.#options.witness_identity_sha256 ||
      config.signer_principal !== this.#options.signer.signer_principal ||
      config.signing_key_id !== this.#options.signer.signing_key_id ||
      config.verification_key_sha256 !== this.#options.signer.verification_key_sha256 ||
      config.encrypted_at_rest !== true) throw adapterError("integrity_failed")
    await this.#verifyPhysicalAuthority()
  }

  async #verifyPrivileges(): Promise<void> {
    const reader = await this.#reader.query<{
      config_select: boolean; receipts_select: boolean; heads_select: boolean; migrations_select: boolean
      receipts_insert: boolean; heads_update: boolean; can_advance: boolean
      schema_create: boolean; public_advance: boolean
    }>(`SELECT
      has_table_privilege(current_user, '${SCHEMA}.config', 'SELECT') AS config_select,
      has_table_privilege(current_user, '${SCHEMA}.receipts', 'SELECT') AS receipts_select,
      has_table_privilege(current_user, '${SCHEMA}.heads', 'SELECT') AS heads_select,
      has_table_privilege(current_user, '${SCHEMA}.schema_migrations', 'SELECT') AS migrations_select,
      has_table_privilege(current_user, '${SCHEMA}.receipts', 'INSERT') AS receipts_insert,
      has_table_privilege(current_user, '${SCHEMA}.heads', 'UPDATE') AS heads_update,
      has_function_privilege(current_user, '${SCHEMA}.compare_and_advance(text,bigint,text,bigint,text,text,bytea,text)', 'EXECUTE') AS can_advance,
      has_schema_privilege(current_user, '${SCHEMA}', 'CREATE') AS schema_create,
      has_function_privilege('public', '${SCHEMA}.compare_and_advance(text,bigint,text,bigint,text,text,bytea,text)', 'EXECUTE') AS public_advance`)
    const acknowledgement = await this.#acknowledgement.query<{
      config_select: boolean; receipts_select: boolean; heads_select: boolean; migrations_select: boolean
      receipts_insert: boolean; heads_update: boolean; can_advance: boolean; schema_create: boolean
    }>(`SELECT
      has_table_privilege(current_user, '${SCHEMA}.config', 'SELECT') AS config_select,
      has_table_privilege(current_user, '${SCHEMA}.receipts', 'SELECT') AS receipts_select,
      has_table_privilege(current_user, '${SCHEMA}.heads', 'SELECT') AS heads_select,
      has_table_privilege(current_user, '${SCHEMA}.schema_migrations', 'SELECT') AS migrations_select,
      has_table_privilege(current_user, '${SCHEMA}.receipts', 'INSERT') AS receipts_insert,
      has_table_privilege(current_user, '${SCHEMA}.heads', 'UPDATE') AS heads_update,
      has_function_privilege(current_user, '${SCHEMA}.compare_and_advance(text,bigint,text,bigint,text,text,bytea,text)', 'EXECUTE') AS can_advance,
      has_schema_privilege(current_user, '${SCHEMA}', 'CREATE') AS schema_create`)
    const read = reader[0]
    const ack = acknowledgement[0]
    if (reader.length !== 1 || acknowledgement.length !== 1 || read === undefined || ack === undefined ||
      !read.config_select || !read.receipts_select || !read.heads_select || !read.migrations_select || read.receipts_insert ||
      read.heads_update || read.can_advance || read.schema_create || read.public_advance ||
      ack.config_select || ack.receipts_select || ack.heads_select || ack.migrations_select || ack.receipts_insert ||
      ack.heads_update || !ack.can_advance || ack.schema_create) throw adapterError("integrity_failed")
  }

  async #verifyCatalog(): Promise<void> {
    const ownerRows = await this.#reader.query<{ database_owner: string; schema_owner: string }>(`
      SELECT database_owner.rolname::text AS database_owner,
        schema_owner.rolname::text AS schema_owner
      FROM pg_catalog.pg_database database
      JOIN pg_catalog.pg_roles database_owner ON database_owner.oid = database.datdba
      JOIN pg_catalog.pg_namespace namespace ON namespace.nspname = '${SCHEMA}'
      JOIN pg_catalog.pg_roles schema_owner ON schema_owner.oid = namespace.nspowner
      WHERE database.datname = current_database()
    `)
    if (ownerRows.length !== 1 || ownerRows[0]!.database_owner !== this.#options.expected_migration_role ||
      ownerRows[0]!.schema_owner !== this.#options.expected_migration_role) throw adapterError("integrity_failed")

    const databaseAcls = await this.#reader.query<{
      grantee: string; privilege_type: string; is_grantable: boolean
    }>(`SELECT COALESCE(grantee.rolname::text, 'PUBLIC') AS grantee,
        acl.privilege_type::text AS privilege_type, acl.is_grantable
      FROM pg_catalog.pg_database database
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        database.datacl, pg_catalog.acldefault('d', database.datdba)
      )) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
      WHERE database.datname = current_database()`)
    if (!exactStringSet(databaseAcls.map((row) =>
      `${row.grantee}:${row.privilege_type}:${String(row.is_grantable)}`), [
      `${this.#options.expected_migration_role}:CONNECT:false`,
      `${this.#options.expected_migration_role}:CREATE:false`,
      `${this.#options.expected_migration_role}:TEMPORARY:false`,
      `${this.#options.expected_reader_role}:CONNECT:false`,
      `${this.#options.expected_witness_acknowledgement_role}:CONNECT:false`,
    ])) throw adapterError("integrity_failed")

    const relations = await this.#reader.query<{
      relname: string; owner: string; relkind: string; relpersistence: string; access_method: string
      relrowsecurity: boolean; relforcerowsecurity: boolean
    }>(`SELECT relation.relname::text AS relname, owner.rolname::text AS owner,
        relation.relkind::text AS relkind, relation.relpersistence::text AS relpersistence,
        access_method.amname::text AS access_method,
        relation.relrowsecurity, relation.relforcerowsecurity
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid = relation.relowner
      JOIN pg_catalog.pg_am access_method ON access_method.oid = relation.relam
      WHERE namespace.nspname = '${SCHEMA}' AND relation.relkind = 'r'
      ORDER BY relation.relname`)
    if (!exactStringSet(relations.map((row) => row.relname), EXPECTED_TABLES) ||
      relations.some((row) => row.owner !== this.#options.expected_migration_role || row.relkind !== "r" ||
        row.relpersistence !== "p" || row.access_method !== "heap" ||
        row.relrowsecurity || row.relforcerowsecurity)) throw adapterError("integrity_failed")

    const columns = await this.#reader.query(`SELECT relation.relname, attribute.attnum,
        attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type,
        attribute.attnotnull,
        COALESCE(pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid), '') AS default_expr,
        attribute.attidentity, attribute.attgenerated, COALESCE(attribute.attacl::text, '') AS attacl
      FROM pg_catalog.pg_attribute attribute
      JOIN pg_catalog.pg_class relation ON relation.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef default_value
        ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
      WHERE namespace.nspname = '${SCHEMA}' AND relation.relkind = 'r'
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
      ORDER BY relation.relname, attribute.attnum`)
    if (digestBytes(bytes(JSON.stringify(columns))) !== CATALOG_COLUMNS_SHA256) {
      throw adapterError("integrity_failed")
    }

    const constraints = await this.#reader.query(`SELECT relation.relname, constraint_row.conname,
        constraint_row.contype, constraint_row.condeferrable, constraint_row.condeferred,
        constraint_row.convalidated,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_catalog.pg_constraint constraint_row
      JOIN pg_catalog.pg_class relation ON relation.oid = constraint_row.conrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = '${SCHEMA}' ORDER BY relation.relname, constraint_row.conname`)
    if (digestBytes(bytes(JSON.stringify(constraints))) !== CATALOG_CONSTRAINTS_SHA256) {
      throw adapterError("integrity_failed")
    }

    const indexes = await this.#reader.query(`SELECT relation.relname, index_relation.relname AS index_name,
        index_row.indisunique, index_row.indisprimary, index_row.indisvalid, index_row.indisready,
        pg_catalog.pg_get_indexdef(index_relation.oid) AS definition
      FROM pg_catalog.pg_index index_row
      JOIN pg_catalog.pg_class relation ON relation.oid = index_row.indrelid
      JOIN pg_catalog.pg_class index_relation ON index_relation.oid = index_row.indexrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = '${SCHEMA}' ORDER BY relation.relname, index_relation.relname`)
    if (digestBytes(bytes(JSON.stringify(indexes))) !== CATALOG_INDEXES_SHA256) {
      throw adapterError("integrity_failed")
    }

    const relationAcls = await this.#reader.query<{
      relname: string; grantee: string; privilege_type: string; is_grantable: boolean
    }>(`SELECT relation.relname::text AS relname,
        COALESCE(grantee.rolname::text, 'PUBLIC') AS grantee,
        acl.privilege_type::text AS privilege_type, acl.is_grantable
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        relation.relacl, pg_catalog.acldefault('r', relation.relowner))) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = '${SCHEMA}' AND relation.relkind = 'r'
      ORDER BY relation.relname, grantee, acl.privilege_type`)
    const ownerTablePrivileges = ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
    const expectedRelationAcls = EXPECTED_TABLES.flatMap((table) => [
      ...ownerTablePrivileges.map((privilege) => `${table}:${this.#options.expected_migration_role}:${privilege}:false`),
      `${table}:${this.#options.expected_reader_role}:SELECT:false`,
    ])
    if (!exactStringSet(relationAcls.map((row) =>
      `${row.relname}:${row.grantee}:${row.privilege_type}:${String(row.is_grantable)}`), expectedRelationAcls)) {
      throw adapterError("integrity_failed")
    }

    const schemaAcls = await this.#reader.query<{ grantee: string; privilege_type: string; is_grantable: boolean }>(`
      SELECT COALESCE(grantee.rolname::text, 'PUBLIC') AS grantee,
        acl.privilege_type::text AS privilege_type, acl.is_grantable
      FROM pg_catalog.pg_namespace namespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = '${SCHEMA}'`)
    if (!exactStringSet(schemaAcls.map((row) =>
      `${row.grantee}:${row.privilege_type}:${String(row.is_grantable)}`), [
      `${this.#options.expected_migration_role}:CREATE:false`,
      `${this.#options.expected_migration_role}:USAGE:false`,
      `${this.#options.expected_reader_role}:USAGE:false`,
      `${this.#options.expected_witness_acknowledgement_role}:USAGE:false`,
    ])) throw adapterError("integrity_failed")

    const functions = await this.#reader.query<{
      identity: string; owner: string; language: string; prosecdef: boolean; proconfig: string[] | string | null
      definition: string
    }>(`SELECT procedure.proname::text || '(' ||
        pg_catalog.oidvectortypes(procedure.proargtypes) || ')' AS identity,
        owner.rolname::text AS owner, language.lanname::text AS language,
        procedure.prosecdef, procedure.proconfig,
        pg_catalog.pg_get_functiondef(procedure.oid) AS definition
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid = procedure.proowner
      JOIN pg_catalog.pg_language language ON language.oid = procedure.prolang
      WHERE namespace.nspname = '${SCHEMA}' ORDER BY identity`)
    if (!exactStringSet(functions.map((row) => row.identity), EXPECTED_FUNCTIONS) || functions.some((row) => {
      const config = Array.isArray(row.proconfig) ? row.proconfig : row.proconfig === null ? [] : [row.proconfig]
      return row.owner !== this.#options.expected_migration_role || row.language !== "plpgsql" ||
        row.prosecdef !== row.identity.startsWith("compare_and_advance(") ||
        !exactStringSet(config, ["search_path=pg_catalog"]) ||
        digestBytes(bytes(row.definition)) !== FUNCTION_DEFINITION_SHA256[row.identity]
    })) throw adapterError("integrity_failed")

    const functionAcls = await this.#reader.query<{
      identity: string; grantee: string; privilege_type: string; is_grantable: boolean
    }>(`SELECT procedure.proname::text || '(' ||
        pg_catalog.oidvectortypes(procedure.proargtypes) || ')' AS identity,
        COALESCE(grantee.rolname::text, 'PUBLIC') AS grantee,
        acl.privilege_type::text AS privilege_type, acl.is_grantable
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = '${SCHEMA}'`)
    const expectedFunctionAcls = EXPECTED_FUNCTIONS.flatMap((identity) => [
      `${identity}:${this.#options.expected_migration_role}:EXECUTE:false`,
      ...(identity.startsWith("compare_and_advance(")
        ? [`${identity}:${this.#options.expected_witness_acknowledgement_role}:EXECUTE:false`] : []),
    ])
    if (!exactStringSet(functionAcls.map((row) =>
      `${row.identity}:${row.grantee}:${row.privilege_type}:${String(row.is_grantable)}`), expectedFunctionAcls)) {
      throw adapterError("integrity_failed")
    }

    const triggers = await this.#reader.query<{
      tgname: string; relation_name: string; tgenabled: string; tgisinternal: boolean; function_name: string
      definition: string
    }>(`SELECT trigger.tgname::text AS tgname, relation.relname::text AS relation_name,
        trigger.tgenabled::text AS tgenabled, trigger.tgisinternal,
        procedure.proname::text AS function_name,
        pg_catalog.pg_get_triggerdef(trigger.oid, true) AS definition
      FROM pg_catalog.pg_trigger trigger
      JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_proc procedure ON procedure.oid = trigger.tgfoid
      WHERE namespace.nspname = '${SCHEMA}' AND NOT trigger.tgisinternal
      ORDER BY trigger.tgname`)
    const expectedTriggers = [
      "config_immutable:config:O:false:reject_mutation",
      "heads_transition_guard:heads:O:false:validate_head_transition",
      "receipts_immutable:receipts:O:false:reject_mutation",
    ]
    if (!exactStringSet(triggers.map((row) =>
      `${row.tgname}:${row.relation_name}:${row.tgenabled}:${String(row.tgisinternal)}:${row.function_name}`),
    expectedTriggers) || triggers.some((row) =>
      digestBytes(bytes(row.definition)) !== TRIGGER_DEFINITION_SHA256[row.tgname])) {
      throw adapterError("integrity_failed")
    }

    const migrations = await this.#reader.query<{ migration_name: string; checksum_sha256: string }>(
      `SELECT migration_name, checksum_sha256 FROM ${SCHEMA}.schema_migrations`,
    )
    if (migrations.length !== 1 || migrations[0]!.migration_name !== MIGRATION_NAME ||
      migrations[0]!.checksum_sha256 !== MIGRATION_SHA256) throw adapterError("integrity_failed")
  }

  async #verifyPhysicalAuthority(): Promise<void> {
    const receipts = await this.#reader.query<ReceiptRow>(
      `SELECT * FROM ${SCHEMA}.receipts ORDER BY journal_identity_sha256, sequence`,
    )
    const latest = new Map<string, ReceiptRow>()
    for (const receipt of receipts) {
      const prior = latest.get(receipt.journal_identity_sha256)
      const sequence = dbBigint(receipt.sequence)
      if (sequence !== (prior === undefined ? 1n : dbBigint(prior.sequence) + 1n) ||
        receipt.prior_frontier_sha256 !== (prior?.frontier_sha256 ?? null)) {
        throw adapterError("integrity_failed")
      }
      this.#verifyReceipt(receipt)
      latest.set(receipt.journal_identity_sha256, receipt)
    }
    const heads = await this.#reader.query<HeadRow>(`SELECT * FROM ${SCHEMA}.heads ORDER BY journal_identity_sha256`)
    if (heads.length !== latest.size) throw adapterError("integrity_failed")
    for (const head of heads) {
      const receipt = latest.get(head.journal_identity_sha256)
      if (receipt === undefined || dbBigint(head.head_sequence) !== dbBigint(receipt.sequence) ||
        head.head_frontier_sha256 !== receipt.frontier_sha256 ||
        head.head_signed_anchor_sha256 !== receipt.signed_anchor_sha256 ||
        head.head_receipt_sha256 !== receipt.receipt_sha256 ||
        !byteEqual(asBytes(head.head_receipt_bytes), asBytes(receipt.canonical_receipt_bytes))) {
        throw adapterError("integrity_failed")
      }
    }
  }

  #verifyReceipt(row: Readonly<{
    journal_identity_sha256: unknown
    sequence: unknown
    prior_frontier_sha256: unknown
    frontier_sha256: unknown
    signed_anchor_sha256: unknown
    canonical_receipt_bytes: unknown
    receipt_sha256: unknown
  }>): DurableJournalWitnessReceiptV1 {
    if (!isDigest(row.journal_identity_sha256) || !isDigest(row.frontier_sha256) ||
      !isDigest(row.signed_anchor_sha256) || !isDigest(row.receipt_sha256)) {
      throw adapterError("integrity_failed")
    }
    const sequence = dbBigint(row.sequence)
    if (sequence < 1n || (row.prior_frontier_sha256 !== null && !isDigest(row.prior_frontier_sha256)) ||
      ((sequence === 1n) !== (row.prior_frontier_sha256 === null))) throw adapterError("integrity_failed")
    const receiptBytes = asBytes(row.canonical_receipt_bytes)
    if (digestBytes(receiptBytes) !== row.receipt_sha256) throw adapterError("integrity_failed")
    const record = parseCanonicalReceipt(receiptBytes)
    if (!exactKeys(record, [
      "schema_version", "witness_identity_sha256", "restore_domain_sha256",
      "journal_identity_sha256", "expected_sequence", "expected_frontier_sha256",
      "sequence", "frontier_sha256", "signed_anchor_sha256", "signing_key_id", "signature_base64url",
    ]) || record.schema_version !== RECEIPT_SCHEMA_VERSION ||
      record.witness_identity_sha256 !== this.#options.witness_identity_sha256 ||
      record.restore_domain_sha256 !== this.#options.restore_domain_sha256 ||
      record.journal_identity_sha256 !== row.journal_identity_sha256 ||
      record.expected_sequence !== sequence - 1n ||
      record.expected_frontier_sha256 !== row.prior_frontier_sha256 || record.sequence !== sequence ||
      record.frontier_sha256 !== row.frontier_sha256 ||
      record.signed_anchor_sha256 !== row.signed_anchor_sha256 ||
      record.signing_key_id !== this.#options.signer.signing_key_id ||
      typeof record.signature_base64url !== "string") throw adapterError("integrity_failed")
    let signature: Uint8Array
    try {
      signature = Uint8Array.from(Buffer.from(record.signature_base64url, "base64url"))
      if (Buffer.from(signature).toString("base64url") !== record.signature_base64url) {
        throw adapterError("integrity_failed")
      }
    } catch (error) {
      if (isAdapterError(error)) throw error
      throw adapterError("integrity_failed")
    }
    const { signature_base64url: _signature, ...unsigned } = record
    if (signature.byteLength !== 64 ||
      !this.#options.verifier.verify(bytes(canonicalJson(unsigned)), signature)) {
      throw adapterError("integrity_failed")
    }
    return Object.freeze({
      canonical_receipt_bytes: receiptBytes,
      receipt_sha256: row.receipt_sha256,
      sequence,
      frontier_sha256: row.frontier_sha256,
    })
  }

  #requireReady(): void {
    if (!this.#ready) throw adapterError("integrity_failed")
  }
}

export const POSTGRES_DURABLE_JOURNAL_WITNESS_MIGRATION_V1 = Object.freeze({
  name: MIGRATION_NAME,
  relative_path: `migrations/durable-journal-witness/${MIGRATION_NAME}`,
  checksum_sha256: MIGRATION_SHA256,
})
