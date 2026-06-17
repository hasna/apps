import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STORAGE_TABLES,
  createSkillsPostgresSyncStore,
  createSkillsS3ObjectStore,
  createSkillsSnapshotSyncRecord,
  exportSkillsLocalSnapshot,
  getSkillsNativeStorageStatus,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  importSkillsLocalSnapshot,
  planSkillsS3SnapshotUpload,
  resolveSkillsNativeStorageConfig,
  resolveStorageConfig,
  signSkillsAwsV4Request,
  skillsPostgresSyncSchemaSql,
  type SkillsPostgresQueryClient,
} from "./native-storage";

class FakePostgresClient implements SkillsPostgresQueryClient {
  queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  records: any[] = [];
  cursors = new Map<string, string>();

  async query<T = unknown>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
    this.queries.push({ sql, values });
    if (sql.includes("INSERT INTO skills_sync_records") && values) {
      this.records.push({
        scope: values[0],
        kind: values[1],
        id: values[2],
        updated_at: values[3],
        deleted_at: values[4],
        source: values[5],
        payload: JSON.parse(String(values[6])),
      });
      return { rows: [] };
    }
    if (sql.includes("FROM skills_sync_records")) {
      return { rows: this.records as T[] };
    }
    if (sql.includes("SELECT value FROM skills_sync_cursors") && values) {
      const value = this.cursors.get(`${values[0]}:${values[1]}`);
      return { rows: value ? ([{ value }] as T[]) : [] };
    }
    if (sql.includes("INSERT INTO skills_sync_cursors") && values) {
      this.cursors.set(`${values[0]}:${values[1]}`, String(values[2]));
      return { rows: [] };
    }
    return { rows: [] };
  }
}

describe("native storage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `skills-native-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  test("defaults to local storage and ignores hosted API env vars", () => {
    const config = resolveSkillsNativeStorageConfig({
      SKILLS_API_URL: "https://skills.example.com",
      SKILLS_API_KEY: "sk_test",
    });
    expect(config.mode).toBe("local");
    expect(config.databaseUrl).toBeUndefined();
    expect(config.s3Bucket).toBeUndefined();
    expect(config.syncBatchSize).toBe(500);
    expect(config.dryRun).toBe(true);
  });

  test("uses canonical storage helpers and plain skills fallbacks", () => {
    const env = {
      SKILLS_STORAGE_MODE: "remote",
      SKILLS_DATABASE_URL: "postgres://example/fallback-skills",
      SKILLS_S3_BUCKET: "fallback-skills-artifacts",
      SKILLS_SYNC_DRY_RUN: "false",
    };

    const config = resolveStorageConfig(env);
    expect(config).toMatchObject({
      mode: "remote",
      databaseUrl: "postgres://example/fallback-skills",
      s3Bucket: "fallback-skills-artifacts",
      dryRun: false,
    });
    expect(getStorageMode(env)).toBe("remote");
    expect(getStorageDatabaseEnv(env)).toBe("SKILLS_DATABASE_URL");
    expect(getStorageDatabaseUrl(env)).toBe("postgres://example/fallback-skills");

    const status = getStorageStatus({ targetDir: tmpDir, env });
    expect(status).toMatchObject({
      package: "open-skills",
      mode: "remote",
      tables: ["skills_sync_records", "skills_sync_cursors"],
      env: {
        mode: "HASNA_SKILLS_STORAGE_MODE",
        databaseUrl: "HASNA_SKILLS_DATABASE_URL",
        s3Bucket: "HASNA_SKILLS_S3_BUCKET",
      },
      remote: {
        databaseConfigured: true,
        s3Configured: true,
        databaseEnv: "HASNA_SKILLS_DATABASE_URL",
        activeDatabaseEnv: "SKILLS_DATABASE_URL",
      },
    });
    expect(STORAGE_TABLES).toEqual(["skills_sync_records", "skills_sync_cursors"]);
    expect(getSkillsNativeStorageStatus({ targetDir: tmpDir, env })).toEqual(status);
  });

  test("parses explicit hybrid storage config", () => {
    const config = resolveSkillsNativeStorageConfig({
      HASNA_SKILLS_STORAGE_MODE: "hybrid",
      HASNA_SKILLS_DATABASE_URL: "postgres://example/skills",
      HASNA_SKILLS_DATABASE_SSL: "true",
      HASNA_SKILLS_DATABASE_SCHEMA: "skills",
      HASNA_SKILLS_S3_BUCKET: "skills-artifacts",
      HASNA_SKILLS_S3_PREFIX: "prod/skills",
      HASNA_SKILLS_AWS_REGION: "eu-central-1",
      HASNA_SKILLS_SYNC_BATCH_SIZE: "25",
      HASNA_SKILLS_SYNC_DRY_RUN: "false",
    });
    expect(config).toMatchObject({
      mode: "hybrid",
      databaseUrl: "postgres://example/skills",
      databaseSsl: true,
      databaseSchema: "skills",
      s3Bucket: "skills-artifacts",
      s3Prefix: "prod/skills",
      awsRegion: "eu-central-1",
      syncBatchSize: 25,
      dryRun: false,
    });
  });

  test("exports and imports local .skills snapshots", () => {
    const source = join(tmpDir, "source");
    const target = join(tmpDir, "target");
    mkdirSync(join(source, ".skills", "runs", "2026-06-08", "run_1", "logs"), { recursive: true });
    writeFileSync(join(source, ".skills", "project.json"), JSON.stringify({ version: 1, pinnedSkills: ["image"] }));
    writeFileSync(join(source, ".skills", "runs", "2026-06-08", "run_1", "run.json"), JSON.stringify({ id: "run_1" }));
    writeFileSync(join(source, ".skills", "runs", "2026-06-08", "run_1", "logs", "stdout.log"), "ok\n");

    const snapshot = exportSkillsLocalSnapshot(source, { includeFileContents: true });
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.files.map((file) => file.path)).toEqual([
      ".skills/project.json",
      ".skills/runs/2026-06-08/run_1/logs/stdout.log",
      ".skills/runs/2026-06-08/run_1/run.json",
    ]);

    const imported = importSkillsLocalSnapshot(snapshot, target);
    expect(imported).toEqual({ written: 3, skipped: 0 });
    expect(readFileSync(join(target, ".skills", "runs", "2026-06-08", "run_1", "logs", "stdout.log"), "utf8")).toBe("ok\n");
  });

  test("rejects snapshot paths outside .skills", () => {
    expect(() => importSkillsLocalSnapshot({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      files: [{ path: "../escape", sizeBytes: 1, sha256: "bad", contentBase64: "eA==" }],
    }, tmpDir)).toThrow("Unsafe snapshot path");
  });

  test("creates Postgres sync records without a driver dependency", async () => {
    const client = new FakePostgresClient();
    const store = createSkillsPostgresSyncStore(client);
    await store.ensureSchema();
    expect(client.queries[0].sql).toContain("CREATE TABLE IF NOT EXISTS skills_sync_records");
    expect(skillsPostgresSyncSchemaSql).toContain("skills_sync_cursors");

    const snapshot = exportSkillsLocalSnapshot(tmpDir);
    const record = createSkillsSnapshotSyncRecord(snapshot, { scope: "machine-a", id: "state" });
    await store.upsertRecords([record]);
    const pulled = await store.pullUpdatedSince({ scope: "machine-a" });
    expect(pulled[0]).toMatchObject({ scope: "machine-a", kind: "local-snapshot", id: "state" });

    await store.setCursor("machine-a", "pull", "2026-06-08T00:00:00.000Z");
    await expect(store.getCursor("machine-a", "pull")).resolves.toBe("2026-06-08T00:00:00.000Z");
  });

  test("plans and uploads snapshot files to S3 with SigV4 signing", async () => {
    mkdirSync(join(tmpDir, ".skills"), { recursive: true });
    writeFileSync(join(tmpDir, ".skills", "project.json"), "{}\n");
    const snapshot = exportSkillsLocalSnapshot(tmpDir, { includeFileContents: true });
    const plan = planSkillsS3SnapshotUpload(snapshot, { prefix: "opensource/prod/skills" });
    expect(plan[0]).toMatchObject({
      path: ".skills/project.json",
      key: "opensource/prod/skills/.skills/project.json",
    });

    const requests: Array<{ url: string; method?: string; headers: Headers }> = [];
    const store = createSkillsS3ObjectStore({
      bucket: "skills-artifacts",
      region: "us-east-1",
      prefix: "opensource/prod/skills",
      credentials: { accessKeyId: "AKIA_TEST", secretAccessKey: "secret" },
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method, headers: new Headers(init?.headers) });
        return new Response(null, { status: 200, headers: { etag: "\"stored\"" } });
      },
    });
    const uploaded = await store.putObject({ key: ".skills/project.json", body: "{}\n", contentType: "application/json" });
    expect(uploaded.key).toBe("opensource/prod/skills/.skills/project.json");
    expect(requests[0].method).toBe("PUT");
    expect(requests[0].headers.get("authorization")).toContain("AWS4-HMAC-SHA256");

    const signed = signSkillsAwsV4Request({
      method: "PUT",
      url: "https://skills-artifacts.s3.us-east-1.amazonaws.com/test.json",
      region: "us-east-1",
      service: "s3",
      body: "{}",
      credentials: { accessKeyId: "AKIA_TEST", secretAccessKey: "secret" },
      now: new Date("2026-06-08T00:00:00.000Z"),
    });
    expect(signed.canonicalRequest).toContain("/test.json");
    expect(signed.headers.authorization).toContain("Credential=AKIA_TEST/20260608/us-east-1/s3/aws4_request");
  });
});
