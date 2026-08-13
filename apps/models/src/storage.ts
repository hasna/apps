import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { getDbPath } from "./paths.js";
import { parseProviderRef } from "./ref.js";
import { assertModelCapability } from "./capabilities.js";
import type { CatalogEntry, InstalledArtifact, ModelCapability, ProviderRef, RemoteFileEntry } from "./types.js";

const SCHEMA_VERSION = 2;

function rowToInstall(row: Record<string, unknown>): InstalledArtifact {
  return {
    id: String(row.id),
    provider: String(row.provider),
    entityKind: String(row.entity_kind) as InstalledArtifact["entityKind"],
    repoId: String(row.repo_id),
    revision: String(row.revision),
    installPath: String(row.install_path),
    bytes: Number(row.bytes),
    files: JSON.parse(String(row.files_json)) as string[],
    status: String(row.status) as InstalledArtifact["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseInstallRef(input: string): { ref: ProviderRef; hasExplicitRevision: boolean } | null {
  try {
    const trimmed = input.trim();
    const ref = parseProviderRef(trimmed);
    return {
      ref,
      hasExplicitRevision: trimmed.includes("@"),
    };
  } catch {
    return null;
  }
}

function rowToCapability(row: Record<string, unknown>): ModelCapability {
  return JSON.parse(String(row.capability_json)) as ModelCapability;
}

export class ModelsStore {
  readonly db: Database;

  constructor(path = getDbPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )
    `);

    const row = this.db.query<Record<string, unknown>, []>(
      "SELECT value FROM schema_meta WHERE key = 'schema_version' LIMIT 1",
    ).get();
    const currentVersion = row ? Number(row.value) : 0;
    if (currentVersion >= SCHEMA_VERSION) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS catalog_entries (
        provider TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        task TEXT,
        library_name TEXT,
        license TEXT,
        gated INTEGER NOT NULL,
        private INTEGER NOT NULL,
        downloads INTEGER,
        likes INTEGER,
        tags_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        last_modified TEXT,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY (provider, entity_kind, repo_id, revision)
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS remote_files (
        provider TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER,
        oid TEXT,
        lfs_oid TEXT,
        format TEXT,
        download_url TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY (provider, entity_kind, repo_id, revision, path)
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS installs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        install_path TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        files_json TEXT NOT NULL,
        status TEXT NOT NULL,
        runtime TEXT,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS model_capabilities (
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        capability_version TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        capability_json TEXT NOT NULL,
        provider_health TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, model_id, capability_version)
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_catalog_downloads ON catalog_entries(downloads DESC)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_catalog_task ON catalog_entries(task)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_files_repo ON remote_files(provider, entity_kind, repo_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_model_capabilities_provider_model ON model_capabilities(provider, model_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_model_capabilities_health ON model_capabilities(provider_health)");
    this.db.run(
      "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)",
      [SCHEMA_VERSION],
    );
  }

  upsertCapabilities(capabilities: ModelCapability[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO model_capabilities (
        provider, model_id, capability_version, aliases_json, capability_json,
        provider_health, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, model_id, capability_version) DO UPDATE SET
        aliases_json=excluded.aliases_json,
        capability_json=excluded.capability_json,
        provider_health=excluded.provider_health,
        updated_at=excluded.updated_at
    `);
    const tx = this.db.transaction((items: ModelCapability[]) => {
      for (const capability of items) {
        const valid = assertModelCapability(capability);
        stmt.run(
          valid.provider,
          valid.modelId,
          valid.capabilityVersion,
          JSON.stringify(valid.aliases),
          JSON.stringify(valid),
          valid.providerHealth.status,
          valid.updatedAt,
        );
      }
    });
    tx(capabilities);
    return capabilities.length;
  }

  listCapabilities(options: { provider?: string; health?: string; limit?: number } = {}): ModelCapability[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (options.provider) {
      conditions.push("provider = ?");
      params.push(options.provider);
    }
    if (options.health) {
      conditions.push("provider_health = ?");
      params.push(options.health);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.query<Record<string, unknown>, (string | number)[]>(
      `SELECT * FROM model_capabilities ${where} ORDER BY updated_at DESC, provider ASC, model_id ASC LIMIT ?`,
    ).all(...params, limit);
    return rows.map(rowToCapability);
  }

  findCapability(input: string): ModelCapability | null {
    const exact = this.db.query<Record<string, unknown>, [string, string, string]>(
      `SELECT * FROM model_capabilities
       WHERE model_id = ? OR provider || ':' || model_id = ? OR provider || '/' || model_id = ?
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(input, input, input);
    if (exact) return rowToCapability(exact);

    const rows = this.db.query<Record<string, unknown>, []>(
      "SELECT * FROM model_capabilities ORDER BY updated_at DESC",
    ).all();
    for (const row of rows) {
      const aliases = JSON.parse(String(row.aliases_json)) as string[];
      if (aliases.includes(input)) return rowToCapability(row);
    }
    return null;
  }

  upsertCatalog(entries: CatalogEntry[]): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO catalog_entries (
        provider, entity_kind, repo_id, revision, title, author, task, library_name,
        license, gated, private, downloads, likes, tags_json, metadata_json,
        canonical_url, last_modified, indexed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, entity_kind, repo_id, revision) DO UPDATE SET
        title=excluded.title,
        author=excluded.author,
        task=excluded.task,
        library_name=excluded.library_name,
        license=excluded.license,
        gated=excluded.gated,
        private=excluded.private,
        downloads=excluded.downloads,
        likes=excluded.likes,
        tags_json=excluded.tags_json,
        metadata_json=excluded.metadata_json,
        canonical_url=excluded.canonical_url,
        last_modified=excluded.last_modified,
        indexed_at=excluded.indexed_at
    `);
    const tx = this.db.transaction((items: CatalogEntry[]) => {
      for (const entry of items) {
        stmt.run(
          entry.provider,
          entry.entityKind,
          entry.repoId,
          entry.revision,
          entry.title,
          entry.author ?? null,
          entry.task ?? null,
          entry.libraryName ?? null,
          entry.license ?? null,
          entry.gated ? 1 : 0,
          entry.private ? 1 : 0,
          entry.downloads ?? null,
          entry.likes ?? null,
          JSON.stringify(entry.tags),
          JSON.stringify(entry.metadata),
          entry.canonicalUrl,
          entry.lastModified ?? null,
          now,
        );
      }
    });
    tx(entries);
    return entries.length;
  }

  upsertFiles(files: RemoteFileEntry[]): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO remote_files (
        provider, entity_kind, repo_id, revision, path, size, oid, lfs_oid,
        format, download_url, metadata_json, indexed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, entity_kind, repo_id, revision, path) DO UPDATE SET
        size=excluded.size,
        oid=excluded.oid,
        lfs_oid=excluded.lfs_oid,
        format=excluded.format,
        download_url=excluded.download_url,
        metadata_json=excluded.metadata_json,
        indexed_at=excluded.indexed_at
    `);
    const tx = this.db.transaction((items: RemoteFileEntry[]) => {
      for (const file of items) {
        stmt.run(
          file.provider,
          file.entityKind,
          file.repoId,
          file.revision,
          file.path,
          file.size ?? null,
          file.oid ?? null,
          file.lfsOid ?? null,
          file.format ?? null,
          file.downloadUrl,
          JSON.stringify(file.metadata),
          now,
        );
      }
    });
    tx(files);
    return files.length;
  }

  recordInstall(artifact: InstalledArtifact, metadata: Record<string, unknown> = {}): InstalledArtifact {
    this.db.prepare(`
      INSERT INTO installs (
        id, provider, entity_kind, repo_id, revision, install_path, bytes,
        files_json, status, runtime, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        bytes=excluded.bytes,
        files_json=excluded.files_json,
        status=excluded.status,
        runtime=excluded.runtime,
        metadata_json=excluded.metadata_json,
        updated_at=excluded.updated_at
    `).run(
      artifact.id,
      artifact.provider,
      artifact.entityKind,
      artifact.repoId,
      artifact.revision,
      artifact.installPath,
      artifact.bytes,
      JSON.stringify(artifact.files),
      artifact.status,
      null,
      JSON.stringify(metadata),
      artifact.createdAt,
      artifact.updatedAt,
    );
    return artifact;
  }

  listInstalls(): InstalledArtifact[] {
    const rows = this.db.query<Record<string, unknown>, []>("SELECT * FROM installs ORDER BY updated_at DESC").all();
    return rows.map(rowToInstall);
  }

  findInstall(repoIdOrId: string): InstalledArtifact | null {
    const row = this.db.query<Record<string, unknown>, [string, string]>(
      "SELECT * FROM installs WHERE id = ? OR repo_id = ? ORDER BY updated_at DESC LIMIT 1",
    ).get(repoIdOrId, repoIdOrId);
    if (row) return rowToInstall(row);

    const parsed = parseInstallRef(repoIdOrId);
    if (!parsed) return null;

    const refRow = parsed.hasExplicitRevision
      ? this.db.query<Record<string, unknown>, [string, string, string, string]>(
        `SELECT * FROM installs
         WHERE provider = ? AND entity_kind = ? AND repo_id = ? AND revision = ?
         ORDER BY updated_at DESC LIMIT 1`,
      ).get(parsed.ref.provider, parsed.ref.entityKind, parsed.ref.repoId, parsed.ref.revision)
      : this.db.query<Record<string, unknown>, [string, string, string]>(
        `SELECT * FROM installs
         WHERE provider = ? AND entity_kind = ? AND repo_id = ?
         ORDER BY updated_at DESC LIMIT 1`,
      ).get(parsed.ref.provider, parsed.ref.entityKind, parsed.ref.repoId);
    return refRow ? rowToInstall(refRow) : null;
  }

  deleteInstall(id: string): boolean {
    const result = this.db.prepare("DELETE FROM installs WHERE id = ?").run(id);
    return result.changes > 0;
  }

  catalogStats(): { catalogEntries: number; remoteFiles: number; installs: number; capabilities: number } {
    const one = <T extends string>(table: T): number => {
      const row = this.db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM ${table}`).get();
      return Number(row?.count ?? 0);
    };
    return {
      catalogEntries: one("catalog_entries"),
      remoteFiles: one("remote_files"),
      installs: one("installs"),
      capabilities: one("model_capabilities"),
    };
  }

  topCatalog(limit = 20): CatalogEntry[] {
    const rows = this.db.query<Record<string, unknown>, [number]>(
      "SELECT * FROM catalog_entries ORDER BY COALESCE(downloads, 0) DESC, COALESCE(likes, 0) DESC LIMIT ?",
    ).all(limit);
    return rows.map((row) => ({
      provider: String(row.provider),
      entityKind: String(row.entity_kind) as CatalogEntry["entityKind"],
      repoId: String(row.repo_id),
      revision: String(row.revision),
      canonicalUrl: String(row.canonical_url),
      title: String(row.title),
      author: row.author == null ? null : String(row.author),
      task: row.task == null ? null : String(row.task),
      libraryName: row.library_name == null ? null : String(row.library_name),
      license: row.license == null ? null : String(row.license),
      gated: Boolean(row.gated),
      private: Boolean(row.private),
      downloads: row.downloads == null ? null : Number(row.downloads),
      likes: row.likes == null ? null : Number(row.likes),
      tags: JSON.parse(String(row.tags_json)) as string[],
      lastModified: row.last_modified == null ? null : String(row.last_modified),
      metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
    }));
  }
}

export function createStore(path?: string): ModelsStore {
  return new ModelsStore(path);
}
