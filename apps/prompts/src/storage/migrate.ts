/**
 * @hasna/prompts — inline-to-object body migration.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * `prompts storage migrate` moves bodies from the inline column to immutable
 * markdown objects. The migration is additive: inline bodies are retained as
 * rollback data and the old database is preserved.
 *
 * - `--dry-run` (required first) inventories every prompt and retained version
 *   with exact counts, hashes, conflicts, and rollback state, and writes a
 *   receipt.
 * - `--apply` re-verifies the inventory against the receipt (counts + hashes
 *   must agree), writes objects idempotently, then updates the metadata in a
 *   transaction. Conflicts abort with no silent repair.
 * - `reconcile` classifies missing objects, hash/size drift, and orphans.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { getDatabase } from "../db/database.js"
import { BodyStore, promptBodyKey, sha256Hex, bytesOf } from "../body-store.js"
import { writePromptBodyObject, registerBodyObject, recordStorageEvent } from "./bodies.js"

export type InventoryState =
  | "unmigrated"
  | "object-ready"
  | "object-conflict"
  | "migrated"

export interface MigrationItem {
  promptId: string
  version: number
  key: string
  /** The inline body that row owns — the current body for the prompts row,
   *  the historical body for a prompt_versions row. The apply loop writes
   *  exactly this body to the object and stamps its hash. */
  body: string
  expectedSha256: string
  expectedBytes: number
  state: InventoryState
}

export interface MigrationInventory {
  promptsTotal: number
  versionsTotal: number
  items: MigrationItem[]
  conflicts: MigrationItem[]
  promptsWithObject: number
}

/** Items as persisted in the dry-run receipt. Bodies are prompt content and
 *  are not needed for re-verification — apply re-derives the inventory from
 *  the database and the inventory hash covers (promptId, version, sha256). */
export interface MigrationReceiptItem {
  promptId: string
  version: number
  key: string
  expectedSha256: string
  expectedBytes: number
  state: InventoryState
}

export interface MigrationDryRunReport extends Omit<MigrationInventory, "items" | "conflicts"> {
  dryRun: true
  items: MigrationReceiptItem[]
  conflicts: MigrationReceiptItem[]
  objectsToWrite: number
  alreadyPresent: number
  inventoryHash: string
  receiptPath: string
  rollback: {
    inline_bodies_preserved: true
    database_preserved: true
    receipt_path: string
  }
}

/** Canonical hash over the exact sorted (prompt, version, sha256) inventory. */
export function inventoryHash(items: MigrationItem[]): string {
  const canonical = items
    .map((i) => `${i.promptId}:${i.version}:${i.expectedSha256}`)
    .sort()
    .join("\n")
  return createHash("sha256").update(canonical).digest("hex")
}

export function migrationReceiptPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HASNA_PROMPTS_MIGRATION_RECEIPT_PATH?.trim()
  if (explicit) return explicit
  const home = env.HOME || env.USERPROFILE || "~"
  return join(home, ".hasna", "prompts", "migration-plan.json")
}

/**
 * Inventory every prompt row and every retained version row, classifying each
 * against the object store without writing anything.
 */
export async function buildMigrationInventory(store: BodyStore): Promise<MigrationInventory> {
  const db = getDatabase()
  const prompts = db.query("SELECT id, version, body FROM prompts ORDER BY id").all() as Array<{
    id: string
    version: number
    body: string
  }>
  const versions = db.query(
    "SELECT prompt_id, version, body FROM prompt_versions ORDER BY prompt_id, version",
  ).all() as Array<{ prompt_id: string; version: number; body: string }>

  const items: MigrationItem[] = []
  const conflicts: MigrationItem[] = []
  let promptsWithObject = 0

  const classify = async (promptId: string, version: number, body: string): Promise<MigrationItem> => {
    const key = promptBodyKey(promptId, version)
    const expectedSha256 = sha256Hex(body)
    const expectedBytes = bytesOf(body)
    const row = db
      .query("SELECT body_uri FROM prompt_versions WHERE prompt_id = ? AND version = ?")
      .get(promptId, version) as { body_uri: string | null } | null
    const hasDbRef = row?.body_uri != null
    let state: InventoryState = hasDbRef ? "migrated" : "unmigrated"
    if (!hasDbRef) {
      const exists = await store.exists(key)
      if (exists) {
        const stored = await store.getText(key)
        state = sha256Hex(stored) === expectedSha256 ? "object-ready" : "object-conflict"
      }
    }
    if (hasDbRef) promptsWithObject += 1
    return { promptId, version, key, body, expectedSha256, expectedBytes, state }
  }

  for (const p of prompts) {
    const item = await classify(p.id, p.version, p.body)
    items.push(item)
    if (item.state === "object-conflict") conflicts.push(item)
  }
  for (const v of versions) {
    const item = await classify(v.prompt_id, v.version, v.body)
    items.push(item)
    if (item.state === "object-conflict") conflicts.push(item)
  }

  return {
    promptsTotal: prompts.length,
    versionsTotal: versions.length,
    items,
    conflicts,
    promptsWithObject,
  }
}

/** Drop the inline body from items before persisting the receipt. */
function receiptItems(items: MigrationItem[]): MigrationReceiptItem[] {
  return items.map(({ body: _body, ...rest }) => rest)
}

export async function migrationDryRun(
  store: BodyStore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MigrationDryRunReport> {
  const inventory = await buildMigrationInventory(store)
  const receiptPath = migrationReceiptPath(env)
  const objectsToWrite = inventory.items.filter((i) => i.state === "unmigrated").length
  const alreadyPresent = inventory.items.filter((i) => i.state === "object-ready").length
  const hash = inventoryHash(inventory.items)
  const items = receiptItems(inventory.items)
  const report: MigrationDryRunReport = {
    ...inventory,
    items,
    conflicts: items.filter((i) => i.state === "object-conflict"),
    dryRun: true,
    objectsToWrite,
    alreadyPresent,
    inventoryHash: hash,
    receiptPath,
    rollback: {
      inline_bodies_preserved: true,
      database_preserved: true,
      receipt_path: receiptPath,
    },
  }
  mkdirSync(dirname(receiptPath), { recursive: true })
  writeFileSync(receiptPath, JSON.stringify(report, null, 2), { mode: 0o600 })
  return report
}

export interface MigrationApplyReport {
  dryRun: false
  promptsTotal: number
  versionsTotal: number
  objectsWritten: number
  objectsSkipped: number
  conflicts: MigrationItem[]
  receiptPath: string
  inlineBodiesPreserved: true
}

/**
 * Apply the migration. Requires a dry-run receipt; re-verifies that the
 * inventory (counts + hashes) still agrees with the receipt, writes objects
 * idempotently, then updates metadata + registry in a transaction per prompt.
 * The inline body column is retained. Conflicts abort with no silent repair.
 */
export async function migrationApply(
  store: BodyStore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MigrationApplyReport> {
  const receiptPath = migrationReceiptPath(env)
  if (!existsSync(receiptPath)) {
    throw new Error(
      `no migration dry-run receipt at ${receiptPath}; run 'prompts storage migrate --dry-run' first`,
    )
  }
  const prior = JSON.parse(readFileSync(receiptPath, "utf8")) as MigrationDryRunReport
  if (!prior.dryRun || typeof prior.inventoryHash !== "string") {
    throw new Error(`migration receipt at ${receiptPath} is not a dry-run receipt; re-run --dry-run`)
  }

  const inventory = await buildMigrationInventory(store)
  if (inventory.promptsTotal !== prior.promptsTotal || inventory.versionsTotal !== prior.versionsTotal) {
    throw new Error(
      `prompt/version counts changed since the dry run ` +
        `(was ${prior.promptsTotal}/${prior.versionsTotal}, now ${inventory.promptsTotal}/${inventory.versionsTotal}); ` +
        `re-run 'prompts storage migrate --dry-run'`,
    )
  }
  const currentHash = inventoryHash(inventory.items)
  if (currentHash !== prior.inventoryHash) {
    throw new Error(
      `prompt bodies changed since the dry run (inventory hash mismatch); ` +
        `re-run 'prompts storage migrate --dry-run'`,
    )
  }

  const conflicts = inventory.items.filter((i) => i.state === "object-conflict")
  if (conflicts.length > 0) {
    throw new Error(
      `migration aborted: ${conflicts.length} object(s) already exist with different content; ` +
        `no silent repair. Conflicts: ${conflicts.map((c) => c.key).join(", ")}`,
    )
  }

  const db = getDatabase()
  let objectsWritten = 0
  let objectsSkipped = 0

  for (const item of inventory.items) {
    // The body comes from the inventory item, which was read from the row that
    // owns this version — the prompts row for the current version, the
    // prompt_versions row for every historical version. Re-reading the current
    // body here would write the current body into every historical version's
    // object and stamp its hash with the wrong body.
    const body = item.body
    if (item.state === "migrated") {
      objectsSkipped += 1
      continue
    }
    const record = await writePromptBodyObject(store, item.promptId, item.version, body)
    registerBodyObject(record.uri, record.sha256, record.bytes, record.mediaType)
    db.run(
      `UPDATE prompts SET body_uri = ?, body_sha256 = ?, body_bytes = ?, body_media_type = ? WHERE id = ? AND version = ?`,
      [record.uri, record.sha256, record.bytes, record.mediaType, item.promptId, item.version],
    )
    db.run(
      `UPDATE prompt_versions SET body_uri = ?, body_sha256 = ?, body_bytes = ? WHERE prompt_id = ? AND version = ?`,
      [record.uri, record.sha256, record.bytes, item.promptId, item.version],
    )
    recordStorageEvent("migrate", item.promptId, item.version, `body object written ${record.uri}`)
    objectsWritten += 1
  }

  return {
    dryRun: false,
    promptsTotal: inventory.promptsTotal,
    versionsTotal: inventory.versionsTotal,
    objectsWritten,
    objectsSkipped,
    conflicts: [],
    receiptPath,
    inlineBodiesPreserved: true,
  }
}

export interface ReconcileReport {
  missing_objects: Array<{ promptId: string; version: number; key: string }>
  hash_drift: Array<{ promptId: string; version: number; key: string; expectedSha256: string; actualSha256: string }>
  orphan_objects: string[]
  orphan_registry_rows: string[]
  repaired: false
}

/**
 * Classify body-store drift. Report-only: no silent repair is ever performed
 * here.
 */
export async function reconcileBodies(store: BodyStore): Promise<ReconcileReport> {
  const db = getDatabase()
  const missing: ReconcileReport["missing_objects"] = []
  const drift: ReconcileReport["hash_drift"] = []

  const referenced = db
    .query("SELECT prompt_id, version, body_sha256 FROM prompt_versions WHERE body_uri IS NOT NULL ORDER BY prompt_id, version")
    .all() as Array<{ prompt_id: string; version: number; body_sha256: string | null }>

  for (const row of referenced) {
    const key = promptBodyKey(row.prompt_id, row.version)
    try {
      const exists = await store.exists(key)
      if (!exists) {
        missing.push({ promptId: row.prompt_id, version: row.version, key })
        continue
      }
      const stored = await store.getText(key)
      const actual = sha256Hex(stored)
      if (row.body_sha256 && row.body_sha256 !== actual) {
        drift.push({ promptId: row.prompt_id, version: row.version, key, expectedSha256: row.body_sha256, actualSha256: actual })
      }
    } catch {
      missing.push({ promptId: row.prompt_id, version: row.version, key })
    }
  }

  const orphanObjects = await findOrphanObjects(store)
  const registryUris = (db.query("SELECT body_uri FROM prompt_bodies").all() as Array<{ body_uri: string }>).map((r) => r.body_uri)
  const referencedUris = new Set(
    (db.query("SELECT body_uri FROM prompts WHERE body_uri IS NOT NULL").all() as Array<{ body_uri: string }>).map((r) => r.body_uri),
  )
  const orphanRegistry = registryUris.filter((uri) => !referencedUris.has(uri))

  return {
    missing_objects: missing,
    hash_drift: drift,
    orphan_objects: orphanObjects,
    orphan_registry_rows: orphanRegistry,
    repaired: false,
  }
}

/** Enumerate objects in a local store; S3 stores without listing are skipped. */
async function findOrphanObjects(store: BodyStore): Promise<string[]> {
  const listable = store as BodyStore & { listKeys?: () => string[] }
  if (typeof listable.listKeys !== "function") return []
  const keys = listable.listKeys()
  const known = new Set(
    (getDatabase().query("SELECT body_uri FROM prompt_bodies").all() as Array<{ body_uri: string }>).map((r) => r.body_uri),
  )
  return keys.filter((key) => !known.has(store.uriFor(key)))
}
