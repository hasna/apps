import { afterAll, describe, expect, test } from "bun:test";
import { Pool, type PoolClient } from "pg";
import { FILE_KNOWLEDGE_MANIFEST_MIGRATIONS } from "../db/cloud-migrations.js";
import { wrapExecutor } from "../generated/storage-kit/query.js";
import { buildHostedManifestFileItem } from "../lib/knowledge-manifest-shared.js";
import { knowledgeManifestHighWatermark, listKnowledgeManifestRows } from "./pg-store.js";

const DATABASE_URL = process.env.HASNA_FILES_TEST_POSTGRES_URL;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, max: 4 }) : null;
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
let fixtureSequence = 0;

if (!DATABASE_URL && process.env.FILES_REQUIRE_LIVE_POSTGRES === "1") {
  test("requires a throwaway PostgreSQL database when the live gate is enabled", () => {
    throw new Error("HASNA_FILES_TEST_POSTGRES_URL must point at a throwaway PostgreSQL database");
  });
}

afterAll(async () => {
  await pool?.end();
});

function migrationSqlForSchema(sql: string, schema: string): string {
  return sql.replaceAll("pg_catalog, public", `pg_catalog, ${schema}`);
}

async function createFixtureSchema(client: PoolClient, schema: string): Promise<void> {
  await client.query(`
    CREATE TABLE sources (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
      tenant_id UUID NOT NULL
    );
    CREATE TABLE files (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      name TEXT NOT NULL, mime TEXT NOT NULL, size BIGINT NOT NULL, hash TEXT,
      status TEXT NOT NULL, indexed_at TEXT NOT NULL, modified_at TEXT, tenant_id UUID NOT NULL
    );
    CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, tenant_id UUID NOT NULL);
    CREATE TABLE file_tags (
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL, PRIMARY KEY(file_id, tag_id)
    );
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', tenant_id UUID NOT NULL);
    CREATE TABLE project_files (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL, PRIMARY KEY(project_id, file_id)
    );
    CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', tenant_id UUID NOT NULL);
    CREATE TABLE collection_files (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL, PRIMARY KEY(collection_id, file_id)
    );
    CREATE TABLE file_versions (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      source_ref TEXT NOT NULL, content_hash_algorithm TEXT, content_hash TEXT,
      state TEXT NOT NULL, created_at TEXT NOT NULL, tenant_id UUID NOT NULL
    );
    CREATE TABLE file_search_documents (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      revision_id TEXT, kind TEXT NOT NULL, status TEXT NOT NULL,
      updated_at TEXT NOT NULL, tenant_id UUID NOT NULL
    );
    CREATE TABLE knowledge_source_outbox_events (
      id TEXT PRIMARY KEY, cursor BIGINT NOT NULL UNIQUE, event_type TEXT NOT NULL,
      source_ref TEXT, file_id TEXT, source_id TEXT, revision_id TEXT, previous_revision_id TEXT,
      status TEXT, hash TEXT, size BIGINT, mime TEXT, path TEXT, idempotency_key TEXT UNIQUE,
      metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, tenant_id UUID
    );
  `);
  for (const migration of FILE_KNOWLEDGE_MANIFEST_MIGRATIONS) {
    await client.query(migrationSqlForSchema(migration.sql, schema));
  }
}

async function withPgFixture(
  run: (first: PoolClient, second: PoolClient, schema: string, runtimeRole: string) => Promise<void>,
): Promise<void> {
  if (!pool) return;
  const first = await pool.connect();
  const second = await pool.connect();
  const schema = `files_manifest_${process.pid}_${++fixtureSequence}`;
  const runtimeRole = `${schema}_runtime`;
  try {
    await first.query(`CREATE ROLE ${runtimeRole} NOLOGIN`);
    await first.query(`CREATE SCHEMA ${schema}`);
    await first.query(`SET search_path = ${schema}`);
    await second.query(`SET search_path = ${schema}`);
    await createFixtureSchema(first, schema);
    await run(first, second, schema, runtimeRole);
  } finally {
    await first.query("RESET ROLE");
    await second.query("RESET ROLE");
    await first.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await first.query(`DROP ROLE IF EXISTS ${runtimeRole}`);
    first.release();
    second.release();
  }
}

async function seedFile(client: PoolClient, tenant: string, suffix: string): Promise<void> {
  await client.query(
    "INSERT INTO sources(id,type,enabled,tenant_id) VALUES($1,'s3',TRUE,$2)",
    [`src_${suffix}`, tenant],
  );
  await client.query(
    `INSERT INTO files(id,source_id,name,mime,size,hash,status,indexed_at,modified_at,tenant_id)
     VALUES($1,$2,$3,'text/markdown',12,$4,'active','2026-09-17 00:00:00',NULL,$5)`,
    [`f_${suffix}`, `src_${suffix}`, `${suffix}.md`, suffix.repeat(8), tenant],
  );
}

async function eventRows(client: PoolClient, tenant = TENANT_A) {
  return (await client.query<{ cursor: string; file_id: string; manifest_snapshot: Record<string, unknown> }>(
    `SELECT cursor::text, file_id, manifest_snapshot
     FROM knowledge_source_outbox_events
     WHERE tenant_id=$1 AND manifest_snapshot IS NOT NULL
     ORDER BY knowledge_source_outbox_events.cursor`,
    [tenant],
  )).rows;
}

describe("hosted knowledge manifest PostgreSQL change log", () => {
  test.skipIf(!DATABASE_URL)("is global, transactional, snapshot-stable, tenant-bound, and mutation-complete", async () => {
    await withPgFixture(async (first, second, schema, runtimeRole) => {
      await seedFile(first, TENANT_A, "a");
      await seedFile(first, TENANT_B, "b");
      const afterInsert = await eventRows(first);
      expect(afterInsert).toHaveLength(1);
      expect(afterInsert[0]!.manifest_snapshot).not.toHaveProperty("path");
      expect(afterInsert[0]!.manifest_snapshot.indexed_at).toMatch(
        /^2026-09-17T00:00:00\.000000Z$/,
      );
      expect(JSON.stringify(afterInsert[0]!.manifest_snapshot)).not.toMatch(/bucket|prefix|region|hostname|machine|local_path/);
      for (const migration of FILE_KNOWLEDGE_MANIFEST_MIGRATIONS) {
        await first.query(migrationSqlForSchema(migration.sql, schema));
      }
      expect(await eventRows(first)).toHaveLength(1);
      const capture = (await first.query<{ security_definer: boolean; settings: string[] | null }>(
        `SELECT prosecdef AS security_definer, proconfig AS settings
         FROM pg_proc
         WHERE proname = 'files_capture_knowledge_manifest_change'
           AND pronamespace = current_schema()::regnamespace`,
      )).rows[0]!;
      expect(capture.security_definer).toBe(true);
      expect(capture.settings).toContain(`search_path=pg_catalog, ${schema}`);

      await first.query(`GRANT USAGE ON SCHEMA ${schema} TO ${runtimeRole}`);
      await first.query(`GRANT SELECT, UPDATE ON files TO ${runtimeRole}`);
      const beforeRuntimeUpdate = (await eventRows(first)).length;
      await first.query(`SET ROLE ${runtimeRole}`);
      await first.query("UPDATE files SET name='runtime-write.md' WHERE id='f_a'");
      await first.query("RESET ROLE");
      const afterRuntimeUpdate = await eventRows(first);
      expect(afterRuntimeUpdate).toHaveLength(beforeRuntimeUpdate + 1);
      expect(afterRuntimeUpdate.at(-1)!.manifest_snapshot).toMatchObject({
        file_id: "f_a",
        name: "runtime-write.md",
        indexed_at: "2026-09-17T00:00:00.000000Z",
      });

      await first.query("INSERT INTO tags(id,name,tenant_id) VALUES('tag_a','handbook',$1)", [TENANT_A]);
      await first.query("INSERT INTO file_tags(file_id,tag_id,tenant_id) VALUES('f_a','tag_a',$1)", [TENANT_A]);
      await first.query("INSERT INTO projects(id,tenant_id) VALUES('prj_a',$1)", [TENANT_A]);
      await first.query("INSERT INTO project_files(project_id,file_id,tenant_id) VALUES('prj_a','f_a',$1)", [TENANT_A]);
      await first.query("INSERT INTO collections(id,tenant_id) VALUES('col_a',$1)", [TENANT_A]);
      await first.query("INSERT INTO collection_files(collection_id,file_id,tenant_id) VALUES('col_a','f_a',$1)", [TENANT_A]);
      await first.query(
        `INSERT INTO file_versions(id,file_id,source_ref,content_hash_algorithm,content_hash,state,created_at,tenant_id)
         VALUES('rev_a','f_a','open-files://file/f_a/revision/rev_a','sha256',$1,'active','2026-09-17T00:01:00.000Z',$2)`,
        ["a".repeat(64), TENANT_A],
      );
      await first.query(
        `INSERT INTO file_search_documents(id,file_id,revision_id,kind,status,updated_at,tenant_id)
         VALUES('doc_a','f_a','rev_a','extracted_text','ready','2026-09-17T00:02:00.000Z',$1)`,
        [TENANT_A],
      );

      const client = wrapExecutor(first);
      const stableHigh = await knowledgeManifestHighWatermark(client, TENANT_A);
      const stablePage = await listKnowledgeManifestRows(client, {
        tenant_id: TENANT_A,
        high_watermark: stableHigh,
        since_cursor: "0",
        page_after: "0",
        limit: 10,
      });
      expect(stablePage).toHaveLength(1);
      expect(stablePage[0]!.snapshot.tags).toEqual(["handbook"]);
      expect(stablePage[0]!.snapshot.project_ids).toEqual(["prj_a"]);
      expect(stablePage[0]!.snapshot.collection_ids).toEqual(["col_a"]);
      expect(buildHostedManifestFileItem(stablePage[0]!).extraction.text_available).toBe(true);

      const mutationCursor = BigInt(stableHigh);
      await first.query("UPDATE tags SET name='handbook-renamed' WHERE id='tag_a'");
      await first.query("UPDATE projects SET name='project-renamed' WHERE id='prj_a'");
      await first.query("UPDATE collections SET name='collection-renamed' WHERE id='col_a'");
      await first.query("UPDATE sources SET enabled=FALSE WHERE id='src_a'");
      const afterMetadata = await eventRows(first);
      expect(afterMetadata.filter((row) => BigInt(row.cursor) > mutationCursor)).toHaveLength(4);
      expect(afterMetadata.at(-1)!.manifest_snapshot).toMatchObject({
        tags: ["handbook-renamed"],
        project_ids: ["prj_a"],
        collection_ids: ["col_a"],
        source_enabled: false,
      });

      await first.query("DELETE FROM file_tags WHERE file_id='f_a' AND tag_id='tag_a'");
      await first.query("DELETE FROM project_files WHERE file_id='f_a' AND project_id='prj_a'");
      await first.query("DELETE FROM collection_files WHERE file_id='f_a' AND collection_id='col_a'");
      const currentHigh = await knowledgeManifestHighWatermark(client, TENANT_A);
      expect(BigInt(currentHigh)).toBeGreaterThan(BigInt(stableHigh));
      const oldSnapshot = await listKnowledgeManifestRows(client, {
        tenant_id: TENANT_A,
        high_watermark: stableHigh,
        since_cursor: "0",
        page_after: "0",
        limit: 10,
      });
      expect(oldSnapshot[0]!.snapshot.tags).toEqual(["handbook"]);
      const currentSnapshot = await listKnowledgeManifestRows(client, {
        tenant_id: TENANT_A,
        high_watermark: currentHigh,
        since_cursor: "0",
        page_after: "0",
        limit: 10,
      });
      expect(currentSnapshot[0]!.snapshot.tags).toEqual([]);
      expect(currentSnapshot[0]!.snapshot.project_ids).toEqual([]);
      expect(currentSnapshot[0]!.snapshot.collection_ids).toEqual([]);
      expect(currentSnapshot[0]!.snapshot.source_enabled).toBe(false);

      const tenantB = await listKnowledgeManifestRows(client, {
        tenant_id: TENANT_B,
        high_watermark: await knowledgeManifestHighWatermark(client, TENANT_B),
        since_cursor: "0",
        page_after: "0",
        limit: 10,
      });
      expect(tenantB.map((row) => row.file_id)).toEqual(["f_b"]);

      const committedEvents = await eventRows(first);
      for (let index = 1; index < committedEvents.length; index++) {
        expect(BigInt(committedEvents[index]!.cursor)).toBeGreaterThan(BigInt(committedEvents[index - 1]!.cursor));
      }

      const beforeRollback = await knowledgeManifestHighWatermark(client, TENANT_A);
      await first.query("BEGIN");
      await first.query("UPDATE files SET name='rolled-back.md' WHERE id='f_a'");
      await first.query("ROLLBACK");
      expect(await knowledgeManifestHighWatermark(client, TENANT_A)).toBe(beforeRollback);

      // The singleton clock row serializes cursor allocation with transaction
      // commit: the second writer cannot obtain a later cursor until the first
      // writer commits, so a watermark can never advance past an uncommitted
      // lower cursor.
      await first.query("BEGIN");
      await first.query("UPDATE files SET name='commit-a.md' WHERE id='f_a'");
      let secondFinished = false;
      await second.query("BEGIN");
      const blocked = second.query("UPDATE files SET name='commit-b.md' WHERE id='f_b'").then(() => { secondFinished = true; });
      await Bun.sleep(75);
      expect(secondFinished).toBe(false);
      await first.query("COMMIT");
      await blocked;
      await second.query("COMMIT");
      const all = (await first.query<{ cursor: string }>("SELECT cursor::text FROM knowledge_source_outbox_events ORDER BY cursor DESC LIMIT 2")).rows;
      expect(BigInt(all[0]!.cursor)).toBeGreaterThan(BigInt(all[1]!.cursor));

      await first.query("DELETE FROM sources WHERE id='src_b'");
      expect((await eventRows(first, TENANT_B)).at(-1)!.manifest_snapshot).toMatchObject({
        file_id: "f_b",
        status: "deleted",
      });

      await first.query("UPDATE files_knowledge_manifest_clock SET cursor=9007199254740992 WHERE singleton=TRUE");
      await first.query("UPDATE files SET name='large-cursor.md' WHERE id='f_a'");
      expect(await knowledgeManifestHighWatermark(client, TENANT_A)).toBe("9007199254740993");

      await first.query("DELETE FROM files WHERE id='f_a'");
      const deleted = (await eventRows(first)).at(-1)!;
      expect(deleted.manifest_snapshot).toMatchObject({ file_id: "f_a", status: "deleted" });
    });
  });
});
