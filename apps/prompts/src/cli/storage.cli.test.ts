import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { Database } from "bun:sqlite"
import { sha256Hex } from "../body-store.js"

type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

function runCli(dbPath: string, args: string[], extraEnv: Record<string, string> = {}): CliResult {
  const proc = Bun.spawnSync({
    cmd: ["bun", "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HASNA_PROMPTS_DB_PATH: dbPath,
      PROMPTS_DB_PATH: dbPath,
      ...extraEnv,
    },
  })

  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}

/** Simulate a pre-migration database: strip body-object columns and object files, keeping inline bodies. */
function stripBodyColumns(dbPath: string, home: string): void {
  const db = new Database(dbPath)
  db.run("UPDATE prompts SET body_uri = NULL, body_sha256 = NULL, body_bytes = NULL, body_media_type = NULL")
  db.run("UPDATE prompt_versions SET body_uri = NULL, body_sha256 = NULL, body_bytes = NULL")
  db.run("DELETE FROM prompt_bodies")
  db.close()
  rmSync(join(home, "bodies"), { recursive: true, force: true })
}

describe("storage CLI verbs", () => {
  test("rejects the retired storage-mode selector fail-loudly", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "prompts-cli-storage-"))
    try {
      const result = runCli(join(tempHome, "t.db"), ["--json", "storage", "status"], {
        HASNA_PROMPTS_STORAGE_MODE: "remote",
        HOME: tempHome,
      })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain("retired")
      expect(result.stdout).not.toContain("configured-postgres-url")
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test("storage status reports sqlite client and local body store without values", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "prompts-cli-storage-"))
    try {
      const result = runCli(join(tempHome, "t.db"), ["--json", "storage", "status"], { HOME: tempHome })

      expect(result.exitCode).toBe(0)
      const status = JSON.parse(result.stdout) as {
        client: { transport: string; api_url_present: boolean }
        server: { backend: string }
        body_store: { type: string }
        migration: { prompts_total: number; versions_total: number }
      }
      expect(status.client.transport).toBe("sqlite")
      expect(status.client.api_url_present).toBe(false)
      expect(status.server.backend).toBe("sqlite")
      expect(status.body_store.type).toBe("local")
      expect(status.migration.prompts_total).toBe(0)
      expect(status.migration.versions_total).toBe(0)
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test("migrate requires a dry-run before apply and reports exact counts", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "prompts-cli-storage-"))
    try {
      const env = { HOME: tempHome, HASNA_PROMPTS_MIGRATION_RECEIPT_PATH: join(tempHome, "receipt.json") }
      const dbPath = join(tempHome, "t.db")
      expect(runCli(dbPath, ["save", "One", "--body", "body one", "--slug", "one"], env).exitCode).toBe(0)
      // New writes are object-first, so simulate a pre-migration database.
      stripBodyColumns(dbPath, tempHome)
      // apply without dry-run must fail
      const apply = runCli(dbPath, ["storage", "migrate", "--apply"], env)
      expect(apply.exitCode).toBe(1)
      expect(apply.stderr).toContain("--dry-run")
      // dry-run reports counts
      const dry = runCli(dbPath, ["--json", "storage", "migrate", "--dry-run"], env)
      expect(dry.exitCode).toBe(0)
      const report = JSON.parse(dry.stdout) as {
        dryRun: boolean
        promptsTotal: number
        versionsTotal: number
        objectsToWrite: number
        conflicts: unknown[]
        rollback: { inline_bodies_preserved: boolean }
      }
      expect(report.dryRun).toBe(true)
      expect(report.promptsTotal).toBe(1)
      expect(report.versionsTotal).toBe(1)
      expect(report.objectsToWrite).toBe(2)
      expect(report.conflicts).toEqual([])
      expect(report.rollback.inline_bodies_preserved).toBe(true)
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test("migrate apply writes objects and keeps inline bodies", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "prompts-cli-storage-"))
    try {
      const env = { HOME: tempHome, HASNA_PROMPTS_MIGRATION_RECEIPT_PATH: join(tempHome, "receipt.json") }
      const dbPath = join(tempHome, "t.db")
      expect(runCli(dbPath, ["save", "One", "--body", "body one", "--slug", "one"], env).exitCode).toBe(0)
      stripBodyColumns(dbPath, tempHome)
      expect(runCli(dbPath, ["storage", "migrate", "--dry-run"], env).exitCode).toBe(0)
      const apply = runCli(dbPath, ["--json", "storage", "migrate", "--apply"], env)
      expect(apply.exitCode).toBe(0)
      const report = JSON.parse(apply.stdout) as { objectsWritten: number; inlineBodiesPreserved: boolean }
      expect(report.objectsWritten).toBe(2)
      expect(report.inlineBodiesPreserved).toBe(true)
      // body objects exist under the local body folder
      const status = runCli(dbPath, ["--json", "storage", "status"], env)
      const st = JSON.parse(status.stdout) as { migration: { prompts_with_object: number; versions_with_object: number } }
      expect(st.migration.prompts_with_object).toBe(1)
      expect(st.migration.versions_with_object).toBe(1)
      // reconcile reports clean
      const rec = runCli(dbPath, ["--json", "storage", "reconcile"], env)
      expect(rec.exitCode).toBe(0)
      const rc = JSON.parse(rec.stdout) as { missing_objects: unknown[]; hash_drift: unknown[]; repaired: boolean }
      expect(rc.missing_objects).toEqual([])
      expect(rc.hash_drift).toEqual([])
      expect(rc.repaired).toBe(false)
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test("migrate apply aborts when prompts changed since the dry run", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "prompts-cli-storage-"))
    try {
      const env = { HOME: tempHome, HASNA_PROMPTS_MIGRATION_RECEIPT_PATH: join(tempHome, "receipt.json") }
      const dbPath = join(tempHome, "t.db")
      expect(runCli(dbPath, ["save", "One", "--body", "body one", "--slug", "one"], env).exitCode).toBe(0)
      stripBodyColumns(dbPath, tempHome)
      expect(runCli(dbPath, ["storage", "migrate", "--dry-run"], env).exitCode).toBe(0)
      // change the database after the dry run
      expect(runCli(dbPath, ["save", "Two", "--body", "body two", "--slug", "two"], env).exitCode).toBe(0)
      const apply = runCli(dbPath, ["storage", "migrate", "--apply"], env)
      expect(apply.exitCode).toBe(1)
      expect(apply.stderr).toContain("changed since the dry run")
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test("migrate apply writes each version's own inline body to its object and stamps per-version hashes", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "prompts-cli-storage-"))
    try {
      const env = { HOME: tempHome, HASNA_PROMPTS_MIGRATION_RECEIPT_PATH: join(tempHome, "receipt.json") }
      const dbPath = join(tempHome, "t.db")
      const bodyV1 = "BODY VERSION 1 ORIGINAL"
      const bodyV2 = "BODY VERSION 2 CURRENT"
      expect(runCli(dbPath, ["save", "One", "--body", bodyV1, "--slug", "one"], env).exitCode).toBe(0)
      // second save with a different body creates prompt_versions v2
      expect(runCli(dbPath, ["update", "one", "--body", bodyV2], env).exitCode).toBe(0)

      const db = new Database(dbPath)
      const promptId = (db.query("SELECT id FROM prompts WHERE slug = 'one'").get() as { id: string }).id
      db.close()

      stripBodyColumns(dbPath, tempHome)
      expect(runCli(dbPath, ["storage", "migrate", "--dry-run"], env).exitCode).toBe(0)
      const apply = runCli(dbPath, ["--json", "storage", "migrate", "--apply"], env)
      expect(apply.exitCode).toBe(0)
      const report = JSON.parse(apply.stdout) as { objectsWritten: number }
      expect(report.objectsWritten).toBe(3)

      // each historical version's object must carry that version's own body
      const objectV1 = readFileSync(join(tempHome, "bodies", "prompts", promptId, "versions", "1.md"), "utf8")
      const objectV2 = readFileSync(join(tempHome, "bodies", "prompts", promptId, "versions", "2.md"), "utf8")
      expect(objectV1).toBe(bodyV1)
      expect(objectV2).toBe(bodyV2)

      // per-version hash stamps must match the body inside each object
      const check = new Database(dbPath)
      const v1 = check.query("SELECT body_sha256, body_bytes, body_uri FROM prompt_versions WHERE prompt_id = ? AND version = 1").get(promptId) as {
        body_sha256: string | null
        body_bytes: number | null
        body_uri: string | null
      }
      const v2 = check.query("SELECT body_sha256, body_bytes, body_uri FROM prompt_versions WHERE prompt_id = ? AND version = 2").get(promptId) as {
        body_sha256: string | null
        body_bytes: number | null
        body_uri: string | null
      }
      const cur = check.query("SELECT body_sha256 FROM prompts WHERE id = ?").get(promptId) as { body_sha256: string | null }
      check.close()

      expect(v1.body_uri).not.toBeNull()
      expect(v2.body_uri).not.toBeNull()
      expect(v1.body_sha256).toBe(sha256Hex(bodyV1))
      expect(v2.body_sha256).toBe(sha256Hex(bodyV2))
      expect(cur.body_sha256).toBe(sha256Hex(bodyV2))
      expect(v1.body_bytes).toBe(Buffer.byteLength(bodyV1, "utf8"))
      expect(v2.body_bytes).toBe(Buffer.byteLength(bodyV2, "utf8"))

      // reconcile stays clean: metadata agrees with object content
      const rec = runCli(dbPath, ["--json", "storage", "reconcile"], env)
      expect(rec.exitCode).toBe(0)
      const rc = JSON.parse(rec.stdout) as { missing_objects: unknown[]; hash_drift: unknown[] }
      expect(rc.missing_objects).toEqual([])
      expect(rc.hash_drift).toEqual([])
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  test("migrate apply completes when historical objects already exist, without aborting mid-loop", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "prompts-cli-storage-"))
    try {
      const env = { HOME: tempHome, HASNA_PROMPTS_MIGRATION_RECEIPT_PATH: join(tempHome, "receipt.json") }
      const dbPath = join(tempHome, "t.db")
      const bodyV1 = "BODY VERSION 1 ORIGINAL"
      const bodyV2 = "BODY VERSION 2 CURRENT"
      expect(runCli(dbPath, ["save", "One", "--body", bodyV1, "--slug", "one"], env).exitCode).toBe(0)
      expect(runCli(dbPath, ["update", "one", "--body", bodyV2], env).exitCode).toBe(0)

      const db = new Database(dbPath)
      const promptId = (db.query("SELECT id FROM prompts WHERE slug = 'one'").get() as { id: string }).id
      db.close()

      stripBodyColumns(dbPath, tempHome)
      // a previous partial apply already wrote the version-1 object with its own body
      const v1Dir = join(tempHome, "bodies", "prompts", promptId, "versions")
      mkdirSync(v1Dir, { recursive: true })
      writeFileSync(join(v1Dir, "1.md"), bodyV1, { mode: 0o600 })

      expect(runCli(dbPath, ["storage", "migrate", "--dry-run"], env).exitCode).toBe(0)
      const apply = runCli(dbPath, ["--json", "storage", "migrate", "--apply"], env)
      expect(apply.exitCode).toBe(0)
      const report = JSON.parse(apply.stdout) as { objectsWritten: number; conflicts: unknown[] }
      expect(report.conflicts).toEqual([])
      expect(report.objectsWritten).toBe(3)

      // the pre-existing object was reused, not overwritten with the current body
      const objectV1 = readFileSync(join(v1Dir, "1.md"), "utf8")
      const objectV2 = readFileSync(join(tempHome, "bodies", "prompts", promptId, "versions", "2.md"), "utf8")
      expect(objectV1).toBe(bodyV1)
      expect(objectV2).toBe(bodyV2)

      // every item's metadata was updated (none aborted mid-loop)
      const check = new Database(dbPath)
      const refs = check.query("SELECT version, body_sha256 FROM prompt_versions WHERE prompt_id = ? ORDER BY version").all(promptId) as Array<{
        version: number
        body_sha256: string | null
      }>
      check.close()
      expect(refs.length).toBe(2)
      expect(refs.map((r) => r.body_sha256)).toEqual([sha256Hex(bodyV1), sha256Hex(bodyV2)])
    } finally {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })
})
