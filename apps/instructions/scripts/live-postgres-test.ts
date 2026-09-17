#!/usr/bin/env bun
import { Client } from "pg";
import { instructionsSchemaSql } from "../src/storage/schema.js";
import * as store from "../src/storage/cloud-store.js";
import type { TypedQueryClient } from "../src/generated/storage-kit/index.js";

export function assertSafePostgresTestUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("instructions live PostgreSQL gate requires a valid test database URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("instructions live PostgreSQL gate accepts only postgres URLs");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("instructions live PostgreSQL gate refuses non-local hosts");
  }
  const database = url.pathname.replace(/^\/+/, "");
  if (!/^instructions(?:_|-)(?:ci|test)(?:[_-][a-z0-9_-]+)?$/i.test(database)) {
    throw new Error("instructions live PostgreSQL gate requires an instructions_ci or instructions_test database");
  }
  return url;
}

function adapter(client: Client): TypedQueryClient {
  return {
    async many<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      return (await client.query(sql, [...params])).rows as T[];
    },
    async get<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      return ((await client.query(sql, [...params])).rows[0] as T | undefined) ?? null;
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      await client.query(sql, [...params]);
    },
    async transaction<T>(fn: (tx: TypedQueryClient) => Promise<T>): Promise<T> {
      await client.query("BEGIN");
      try {
        const result = await fn(adapter(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
    async close(): Promise<void> {
      await client.end();
    },
  };
}

export async function runLivePostgresTest(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const raw = env.HASNA_INSTRUCTIONS_TEST_DATABASE_URL ?? env.INSTRUCTIONS_TEST_DATABASE_URL;
  if (!raw) {
    throw new Error("HASNA_INSTRUCTIONS_TEST_DATABASE_URL is required; point it at an isolated local instructions_ci database");
  }
  assertSafePostgresTestUrl(raw);
  const client = new Client({ connectionString: raw });
  await client.connect();
  const schema = `instructions_gate_${process.pid}_${Date.now()}`;
  if (!/^[a-z0-9_]+$/.test(schema)) throw new Error("invalid generated PostgreSQL test schema");
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const db = adapter(client);
    for (const sql of instructionsSchemaSql()) await db.execute(sql);

    const created = await store.createConfig(db, {
      name: "Live PostgreSQL Gate",
      category: "rules",
      agent: "codex",
      content: "Keep the production migration path verified.\n",
      format: "markdown",
    });
    const updated = await store.updateConfig(db, created.id, { content: "Verified update.\n" });
    if (updated.version !== 2) throw new Error(`expected config version 2, received ${updated.version}`);
    const snapshots = await store.listSnapshots(db, created.id);
    if (snapshots.length !== 2) throw new Error(`expected 2 snapshots, received ${snapshots.length}`);

    const profile = await store.createProfile(db, { name: "Live Gate Profile" });
    await store.addConfigToProfile(db, profile.id, created.id);
    const members = await store.getProfileConfigs(db, profile.id);
    if (members.length !== 1 || members[0]?.id !== created.id) {
      throw new Error("profile membership did not round-trip through PostgreSQL");
    }
    const stats = await store.getConfigStats(db);
    if (stats.total !== 1 || stats.rules !== 1) throw new Error("PostgreSQL stats did not match the inserted fixture");
    console.log("[instructions-pg-test-gate] PASS: migration, config CRUD, snapshots, profiles, and stats");
  } finally {
    await client.query("RESET search_path").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await client.end();
  }
}

if (import.meta.main) {
  await runLivePostgresTest();
}
