import type { Command } from "commander";
import chalk from "chalk";
import { join, resolve, dirname } from "node:path";
import { existsSync, statSync, copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { getDbPath } from "../../db/database.js";
import { isApiMode } from "../../db/api-mode.js";
import { listMemoriesBounded } from "../../db/memories.js";
import { getDataRoot } from "../../lib/paths.js";
import {
  outputJson,
  makeHandleError,
  type GlobalOpts,
} from "../helpers.js";

/**
 * Write the cloud store's memories into a backup file in the same SQLite
 * format a local `mementos backup` produces — the `memories` table is exactly
 * what `mementos restore` reads (`SELECT * FROM memories`, passed to
 * bulkUpsertMemories), so `backup` → `restore` round-trips in BOTH transports.
 * The table is intentionally created with the full column set the restore
 * path maps by name; fields the API does not carry are left NULL and the
 * restore path falls back to its documented defaults.
 *
 * The file is a MEMORIES-ONLY CARRIER: it holds this one bespoke table and no
 * `_migrations` history or other mementos tables, so it is self-identifying
 * through the `_backup_carrier` marker table. `mementos restore` in API mode
 * re-ships its rows into the hosted store; the LOCAL restore arm refuses it —
 * a single-table file can never replace the full on-box database.
 */
function writeMemoriesBackupFile(
  dest: string,
  rows: Array<Record<string, unknown>>,
): number {
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  // The local arm overwrites an existing destination via copyFileSync; the
  // hosted arm must match, or a second `backup <same-path>` run would hit a
  // UNIQUE conflict on the re-opened file's primary key. Delete a pre-existing
  // destination first (an EISDIR on a directory mirrors copyFileSync's error).
  if (existsSync(dest)) {
    unlinkSync(dest);
  }
  const backupDb = new Database(dest);
  try {
    backupDb.run(`
      CREATE TABLE IF NOT EXISTS _backup_carrier (
        format INTEGER NOT NULL
      )
    `);
    backupDb.run(`INSERT INTO _backup_carrier (format) VALUES (1)`);
    backupDb.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT,
        scope TEXT,
        summary TEXT,
        tags TEXT,
        importance INTEGER,
        source TEXT,
        status TEXT,
        pinned INTEGER,
        agent_id TEXT,
        project_id TEXT,
        session_id TEXT,
        machine_id TEXT,
        namespace TEXT,
        created_by_agent TEXT,
        when_to_use TEXT,
        sequence_group TEXT,
        sequence_order INTEGER,
        metadata TEXT,
        access_count INTEGER,
        version INTEGER,
        expires_at TEXT,
        valid_from TEXT,
        valid_until TEXT,
        ingested_at TEXT,
        created_at TEXT,
        updated_at TEXT,
        accessed_at TEXT
      )
    `);
    const insert = backupDb.prepare(
      `INSERT INTO memories (id, key, value, category, scope, summary, tags, importance, source, status, pinned, agent_id, project_id, session_id, machine_id, namespace, created_by_agent, when_to_use, sequence_group, sequence_order, metadata, access_count, version, expires_at, valid_from, valid_until, ingested_at, created_at, updated_at, accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    type Bind = string | number | null;
    const bind = (v: unknown): Bind => {
      if (v === undefined || v === null) return null;
      return typeof v === "string" || typeof v === "number" ? v : JSON.stringify(v);
    };
    const boolBind = (v: unknown): Bind =>
      v === undefined || v === null ? null : v ? 1 : 0;
    for (const row of rows) {
      const params: Bind[] = [
        bind(row["id"]),
        bind(row["key"]),
        bind(row["value"]),
        bind(row["category"]),
        bind(row["scope"]),
        bind(row["summary"]),
        Array.isArray(row["tags"]) ? JSON.stringify(row["tags"]) : bind(row["tags"]),
        bind(row["importance"]),
        bind(row["source"]),
        bind(row["status"]),
        boolBind(row["pinned"]),
        bind(row["agent_id"]),
        bind(row["project_id"]),
        bind(row["session_id"]),
        bind(row["machine_id"]),
        bind(row["namespace"]),
        bind(row["created_by_agent"]),
        bind(row["when_to_use"]),
        bind(row["sequence_group"]),
        bind(row["sequence_order"]),
        bind(row["metadata"]),
        bind(row["access_count"]),
        bind(row["version"]),
        bind(row["expires_at"]),
        bind(row["valid_from"]),
        bind(row["valid_until"]),
        bind(row["ingested_at"]),
        bind(row["created_at"]),
        bind(row["updated_at"]),
        bind(row["accessed_at"]),
      ];
      insert.run(...params);
    }
    return rows.length;
  } finally {
    backupDb.close();
  }
}

export function registerBackupCommand(program: Command): void {
  const handleError = makeHandleError(program);

  program
    .command("backup [path]")
    .description("Backup the SQLite database to a file")
    .option("--list", "List available backups in the mementos backups dir")
    .action((targetPath: string | undefined, opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const backupsDir = join(getDataRoot(), "backups");

        // --list: show available backups
        if (opts.list) {
          if (!existsSync(backupsDir)) {
            if (globalOpts.json) {
              outputJson({ backups: [] });
              return;
            }
            console.log(chalk.yellow("No backups directory found."));
            return;
          }

          const files = readdirSync(backupsDir)
            .filter((f: string) => f.endsWith(".db"))
            .map((f: string) => {
              const filePath = resolve(backupsDir, f);
              const st = statSync(filePath);
              return { name: f, path: filePath, size: st.size, mtime: st.mtime };
            })
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

          if (files.length === 0) {
            if (globalOpts.json) {
              outputJson({ backups: [] });
              return;
            }
            console.log(chalk.yellow("No backups found."));
            return;
          }

          if (globalOpts.json) {
            outputJson({
              backups: files.map((f) => ({
                name: f.name,
                path: f.path,
                size: f.size,
                modified: f.mtime.toISOString(),
              })),
            });
            return;
          }

          console.log(chalk.bold(`Backups in ${backupsDir}:`));
          for (const f of files) {
            const date = f.mtime.toISOString().replace("T", " ").slice(0, 19);
            const sizeMB = (f.size / (1024 * 1024)).toFixed(1);
            const sizeStr = f.size >= 1024 * 1024 ? `${sizeMB} MB` : `${(f.size / 1024).toFixed(1)} KB`;
            console.log(`  ${chalk.dim(date)}  ${chalk.cyan(sizeStr.padStart(8))}  ${f.name}`);
          }
          return;
        }

        let dest: string;
        if (targetPath) {
          dest = resolve(targetPath);
        } else {
          if (!existsSync(backupsDir)) {
            mkdirSync(backupsDir, { recursive: true });
          }
          const now = new Date();
          const ts = now.toISOString().replace(/[-:T]/g, "").replace(/\..+/, "").slice(0, 15);
          dest = resolve(backupsDir, `mementos-${ts}.db`);
        }

        // Ensure destination directory exists
        const destDir = dirname(dest);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }

        // Hosted backup: the store is the cloud API, not an on-box SQLite file.
        // Snapshot the cloud store's full memory population through the API
        // into the portable backup format, so `backup`/`restore` round-trip in
        // BOTH transports and a hosted client never snapshots a stale local
        // island (or fails with "Database not found") as a green-looking back
        // up. The restore path is the exact inverse: it re-ships this file's
        // `memories` table into the cloud through the faithful idempotent
        // bulk-restore primitive.
        if (isApiMode()) {
          // Full population, not one page — walk every page like `export`
          // does (BUG 2796806b) so a large cloud store is captured whole.
          const { rows } = listMemoriesBounded({}, undefined);
          const count = writeMemoriesBackupFile(dest, rows as unknown as Array<Record<string, unknown>>);
          const st = statSync(dest);
          const sizeMB = (st.size / (1024 * 1024)).toFixed(1);
          const sizeStr = st.size >= 1024 * 1024 ? `${sizeMB} MB` : `${(st.size / 1024).toFixed(1)} KB`;

          if (globalOpts.json) {
            outputJson({ backed_up_to: dest, size: st.size, source: "cloud-api", memories: count });
            return;
          }
          console.log(`Backed up to: ${chalk.green(dest)} (size: ${sizeStr})`);
          console.log(`  Source:   hosted store (cloud-api)`);
          console.log(`  Memories: ${chalk.cyan(String(count))}`);
          return;
        }

        // Backup the database (local path)
        const dbPath = getDbPath();
        if (!existsSync(dbPath)) {
          console.error(chalk.red(`Database not found at ${dbPath}`));
          process.exit(1);
        }

        copyFileSync(dbPath, dest);
        const st = statSync(dest);
        const sizeMB = (st.size / (1024 * 1024)).toFixed(1);
        const sizeStr = st.size >= 1024 * 1024 ? `${sizeMB} MB` : `${(st.size / 1024).toFixed(1)} KB`;

        if (globalOpts.json) {
          outputJson({ backed_up_to: dest, size: st.size, source: dbPath });
          return;
        }
        console.log(`Backed up to: ${chalk.green(dest)} (size: ${sizeStr})`);
      } catch (e) {
        handleError(e);
      }
    });
}
