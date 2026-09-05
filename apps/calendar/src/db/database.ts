import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { dataDir as resolverDataDir } from "@hasna/contracts/paths";

function isInMemoryDb(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

function findNearestCalendarDb(startDir: string, homeDir?: string): string | null {
  let dir = resolve(startDir);
  const resolvedHome = homeDir ? resolve(homeDir) : null;
  while (true) {
    const candidate = join(dir, ".calendar", "calendar.db");
    if (existsSync(candidate) && dir !== resolvedHome) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findGitRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getDbPath(): string {
  // During tests, default to in-memory so parallel/serial workers don't share state
  if (process.env["BUN_TEST"]) {
    return ":memory:";
  }

  if (process.env["CALENDAR_DB_PATH"]) {
    return process.env["CALENDAR_DB_PATH"];
  }

  const home = process.env["HOME"] || homedir();
  const cwd = process.cwd();

  // Explicit env override: project-scoped data is a deliberate opt-in and
  // stays. The DEFAULT is canonical — the resolver data root — never cwd-relative.
  if (process.env["CALENDAR_DB_SCOPE"] === "project") {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot) {
      return join(gitRoot, ".calendar", "calendar.db");
    }
  }

  // Legacy nearest-ancestor databases are per-project datasets. Each one
  // migrates to its own project-scoped canonical path, so one project's data
  // is never silently routed into another project's database (the old code
  // consolidated every project into whichever database migrated first).
  const nearest = findNearestCalendarDb(cwd, home);
  if (nearest) {
    const target = legacyProjectTarget(nearest, home);
    migrateLegacyData(cwd, home, target);
    return target;
  }

  const canonical = join(resolverDataDir({ app: "calendar", home }), "calendar.db");
  migrateLegacyData(cwd, home, canonical);

  return canonical;
}

// ── One-time legacy-data migration ───────────────────────────────────────────

export interface LegacyDataScan {
  /** The legacy non-canonical database that would be migrated, if any. */
  readonly source: string | null;
  /**
   * The canonical target: the shared resolver-root calendar.db for
   * home-level legacy data, or a project-scoped
   * per-project calendar.db files for legacy
   * nearest-ancestor data.
   */
  readonly target: string;
  readonly wouldMigrate: boolean;
  readonly reason: string;
}

/**
 * Reports whether legacy non-canonical calendar data exists and would be
 * migrated. Read-only — never writes. The dry-run surface for the one-time
 * migration. The reported target matches the routing the default path uses:
 * a legacy nearest-ancestor database migrates to a project-scoped canonical
 * path, while the legacy home database migrates to the shared canonical path.
 */
export function scanLegacyData(cwd = process.cwd(), home = process.env["HOME"] || homedir()): LegacyDataScan {
  const canonical = join(resolverDataDir({ app: "calendar", home }), "calendar.db");
  const nearest = findNearestCalendarDb(cwd, home);
  if (nearest) {
    const target = legacyProjectTarget(nearest, home);
    return {
      source: nearest,
      target,
      wouldMigrate: !existsSync(target),
      reason: "legacy nearest-ancestor .calendar database found (project-scoped target)",
    };
  }
  const legacyPath = join(home, ".calendar", "calendar.db");
  if (existsSync(legacyPath)) {
    return {
      source: legacyPath,
      target: canonical,
      wouldMigrate: !existsSync(canonical),
      reason: "legacy home .calendar database found",
    };
  }
  return { source: null, target: canonical, wouldMigrate: false, reason: "no legacy data found" };
}

/**
 * One-time safe migration of legacy non-canonical calendar data into the
 * canonical root (the calendar data root). Runs only while the target database does
 * not exist, so it is idempotent and resumable: once the target exists it
 * never runs again, and it never overwrites existing canonical data. The
 * source is COPIED (VACUUM INTO), never deleted, and a receipt records the
 * migration. The nearest-ancestor .calendar database (the old default) takes
 * precedence over the legacy home .calendar database, matching the old
 * selection order. The target is chosen by the caller (getDbPath or
 * scanLegacyData) so that project-scoped legacy data keeps its own dataset.
 */
export function migrateLegacyData(cwd: string, home: string, target: string): void {
  if (existsSync(target)) return;

  const nearest = findNearestCalendarDb(cwd, home);
  if (nearest) {
    copyDatabase(nearest, target);
    writeMigrationReceipt(nearest, target);
    return;
  }

  const legacyPath = join(home, ".calendar", "calendar.db");
  if (existsSync(legacyPath)) {
    copyDatabase(legacyPath, target);
    writeMigrationReceipt(legacyPath, target);
  }
}

/**
 * Stable, non-secret project-scoped canonical target for a legacy
 * nearest-ancestor database. Keyed by the legacy database's project directory
 * (the directory that contained .calendar), so two different projects always
 * resolve to two different targets regardless of run order.
 */
function legacyProjectTarget(source: string, home: string): string {
  const projectDir = dirname(dirname(resolve(source)));
  const base = basename(projectDir).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  const hash = createHash("sha1").update(resolve(projectDir)).digest("hex").slice(0, 8);
  return join(resolverDataDir({ app: "calendar", home }), "projects", `${base}-${hash}`, "calendar.db");
}

interface MigrationReceipt {
  readonly source: string;
  readonly target: string;
  readonly migratedAt: string;
}

function writeMigrationReceipt(source: string, target: string): void {
  const receipt: MigrationReceipt = { source, target, migratedAt: new Date().toISOString() };
  writeFileSync(join(dirname(target), "migration-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function copyDatabase(sourcePath: string, targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const sourceDb = new Database(sourcePath, { readonly: true });
  try {
    sourceDb.run(`VACUUM INTO ${quoteSqlString(targetPath)}`);
  } finally {
    sourceDb.close();
  }
}

function ensureDir(filePath: string): void {
  if (isInMemoryDb(filePath)) return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

let _db: Database | null = null;

export function getDatabase(dbPath?: string): Database {
  if (_db) return _db;

  const path = dbPath || getDbPath();
  ensureDir(path);

  _db = new Database(path);

  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 5000");
  _db.run("PRAGMA foreign_keys = ON");

  runMigrations(_db);

  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function resetDatabase(dbPath?: string): void {
  const path = dbPath || getDbPath();
  if (_db) {
    _db.close();
    _db = null;
  }
  // For in-memory databases, we can't delete the file — drop all tables instead
  if (isInMemoryDb(path)) {
    const db = new Database(path);
    db.run("PRAGMA foreign_keys = OFF");
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const table of tables) {
      db.run(`DROP TABLE IF EXISTS ${table.name}`);
    }
    runMigrations(db);
    _db = db;
  } else {
    if (!isInMemoryDb(path)) {
      try { unlinkSync(path); } catch { /* doesn't exist yet */ }
    }
    getDatabase(path);
  }
}

// ── Migrations ───────────────────────────────────────────────────────────────

interface Migration {
  id: number;
  up: (db: Database) => void;
}

const migrations: Migration[] = [
  {
    id: 1,
    up: (db: Database) => {
      // Core tables
      db.run(`CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS orgs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        role TEXT,
        title TEXT,
        level TEXT,
        capabilities TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT,
        working_dir TEXT,
        active_org_id TEXT,
        FOREIGN KEY (active_org_id) REFERENCES orgs(id) ON DELETE SET NULL
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS org_memberships (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member', 'service')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(org_id, agent_id),
        FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS calendars (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        owner_id TEXT,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        visibility TEXT NOT NULL DEFAULT 'org' CHECK(visibility IN ('public', 'org', 'private')),
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(org_id, slug),
        FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
        FOREIGN KEY (owner_id) REFERENCES agents(id) ON DELETE SET NULL
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        location TEXT,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('tentative', 'confirmed', 'cancelled')),
        busy_type TEXT NOT NULL DEFAULT 'busy' CHECK(busy_type IN ('busy', 'free', 'out_of_office')),
        visibility TEXT NOT NULL DEFAULT 'default' CHECK(visibility IN ('default', 'private', 'confidential')),
        recurrence_rule TEXT,
        recurrence_exception_dates TEXT,
        source_task_id TEXT,
        created_by TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
        FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES agents(id) ON DELETE SET NULL
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS event_attendees (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        agent_id TEXT,
        display_name TEXT,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'needsAction' CHECK(status IN ('needsAction', 'accepted', 'declined', 'tentative')),
        required INTEGER NOT NULL DEFAULT 1,
        response_comment TEXT,
        responded_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS availability (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        exceptions TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
      )`);

      // FTS index for event search
      db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        title, description, location,
        content='events',
        content_rowid='rowid'
      )`);

      // Triggers for FTS
      db.run(`CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
        INSERT INTO events_fts(rowid, title, description, location)
        VALUES (new.rowid, new.title, new.description, new.location);
      END`);

      db.run(`CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
        INSERT INTO events_fts(events_fts, rowid, title, description, location)
        VALUES ('delete', old.rowid, old.title, old.description, old.location);
      END`);

      db.run(`CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
        INSERT INTO events_fts(events_fts, rowid, title, description, location)
        VALUES ('delete', old.rowid, old.title, old.description, old.location);
        INSERT INTO events_fts(rowid, title, description, location)
        VALUES (new.rowid, new.title, new.description, new.location);
      END`);
    },
  },
];

function runMigrations(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");

  const applied = db.query("SELECT id FROM _migrations ORDER BY id").all() as { id: number }[];
  const appliedIds = new Set(applied.map((r) => r.id));

  for (const migration of migrations) {
    if (!appliedIds.has(migration.id)) {
      migration.up(db);
      db.run("INSERT INTO _migrations (id) VALUES (?)", [migration.id]);
    }
  }
}

export { runMigrations };
