import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { AppSchema, type App } from "./contracts.js";
import { catalogDbPath } from "./paths.js";
import type { CatalogStoreLike, ListAppsOptions, SearchAppsOptions } from "./types.js";

export interface CatalogStoreOptions {
  dbPath?: string;
}

interface AppRow {
  doc: string;
}

/**
 * SQLite-backed read model for `hasna.app.v1` records.
 *
 * READ-MODEL ONLY: the sole write path is `upsertApps`, used by the seed
 * pipeline (and future foundation-owned import jobs). No install/rollout
 * state is ever written here — see `src/ingest.ts` for the read-only
 * rollout event hook.
 */
export class CatalogStore implements CatalogStoreLike {
  private readonly db: Database;

  constructor(options: CatalogStoreOptions = {}) {
    const dbPath = options.dbPath ?? catalogDbPath();
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS apps (
        app_id TEXT PRIMARY KEY,
        npm_name TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        release_channel TEXT NOT NULL,
        summary TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        doc TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_apps_lifecycle ON apps(lifecycle);
      CREATE INDEX IF NOT EXISTS idx_apps_channel ON apps(release_channel);
    `);
  }

  /** Validate and upsert app documents. Returns the number written. */
  upsertApps(apps: App[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO apps (app_id, npm_name, lifecycle, release_channel, summary, tags, doc, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET
        npm_name = excluded.npm_name,
        lifecycle = excluded.lifecycle,
        release_channel = excluded.release_channel,
        summary = excluded.summary,
        tags = excluded.tags,
        doc = excluded.doc,
        updated_at = excluded.updated_at
    `);
    const write = this.db.transaction((docs: App[]) => {
      let count = 0;
      for (const raw of docs) {
        const app = AppSchema.parse(raw);
        stmt.run(
          app.appId,
          app.npmName,
          app.lifecycle,
          app.releaseChannel,
          app.summary ?? null,
          JSON.stringify(app.tags),
          JSON.stringify(app),
          new Date().toISOString()
        );
        count += 1;
      }
      return count;
    });
    return write(apps);
  }

  getApp(appId: string): App | null {
    const row = this.db.prepare("SELECT doc FROM apps WHERE app_id = ?").get(appId) as AppRow | null;
    if (!row) return null;
    return AppSchema.parse(JSON.parse(row.doc));
  }

  listApps(options: ListAppsOptions = {}): App[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (options.lifecycle) {
      clauses.push("lifecycle = ?");
      params.push(options.lifecycle);
    }
    if (options.channel) {
      clauses.push("release_channel = ?");
      params.push(options.channel);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(options.limit ?? 500, 1000));
    const offset = Math.max(0, options.offset ?? 0);
    const rows = this.db
      .prepare(`SELECT doc FROM apps ${where} ORDER BY app_id ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as AppRow[];
    return rows.map((row) => AppSchema.parse(JSON.parse(row.doc)));
  }

  searchApps(query: string, options: SearchAppsOptions = {}): App[] {
    const needle = `%${query.trim().toLowerCase().replaceAll("%", "").replaceAll("_", "")}%`;
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const rows = this.db
      .prepare(
        `SELECT doc FROM apps
         WHERE lower(app_id) LIKE ?
            OR lower(npm_name) LIKE ?
            OR lower(coalesce(summary, '')) LIKE ?
            OR lower(tags) LIKE ?
         ORDER BY app_id ASC LIMIT ?`
      )
      .all(needle, needle, needle, needle, limit) as AppRow[];
    return rows.map((row) => AppSchema.parse(JSON.parse(row.doc)));
  }

  countApps(): number {
    const row = this.db.prepare("SELECT count(*) AS n FROM apps").get() as { n: number };
    return row.n;
  }

  /** Import app documents from a JSONL fixture file. Returns the number imported. */
  importJsonl(content: string): number {
    const apps: App[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      apps.push(AppSchema.parse(JSON.parse(trimmed)));
    }
    return this.upsertApps(apps);
  }

  close(): void {
    this.db.close();
  }
}
