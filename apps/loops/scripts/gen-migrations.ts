#!/usr/bin/env bun
// Emit the ledger-tracked Postgres migrations to migrations/*.sql for review /
// transparency. The SOURCE OF TRUTH is src/lib/storage/postgres-schema.ts
// (POSTGRES_STORAGE_MIGRATIONS); the authoritative runner is `loops-serve
// migrate`, which applies them inside a checksum-guarded ledger. These files
// are a generated mirror — regenerate with `bun run scripts/gen-migrations.ts`.
import { mkdirSync, writeFileSync } from "node:fs";
import { POSTGRES_STORAGE_MIGRATIONS, checksumStorageSql } from "../src/lib/storage/postgres-schema.js";

const dir = new URL("../migrations/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });

const manifest: Array<{ id: string; file: string; checksum: string }> = [];
for (const m of POSTGRES_STORAGE_MIGRATIONS) {
  const file = `${m.id}.sql`;
  const header = `-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["${m.id}"] — DO NOT EDIT.\n-- Source of truth: src/lib/storage/postgres-schema.ts\n-- Runner: loops-serve migrate  (checksum: ${m.checksum})\n\n`;
  writeFileSync(`${dir}${file}`, header + m.sql + "\n");
  manifest.push({ id: m.id, file, checksum: checksumStorageSql(m.sql) });
}
writeFileSync(`${dir}manifest.json`, JSON.stringify({ ledgerTable: "open_loops_schema_migrations", migrations: manifest }, null, 2) + "\n");
console.log(JSON.stringify({ evt: "migrations_emitted", count: manifest.length }));
