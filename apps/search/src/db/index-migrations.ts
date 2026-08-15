import type { Database } from "bun:sqlite";

interface Migration {
  version: number;
  description: string;
  up: (db: Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: "Local file index core",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS index_roots (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          exclude TEXT NOT NULL DEFAULT '[]',
          content_indexing INTEGER NOT NULL DEFAULT 1,
          max_file_size INTEGER NOT NULL DEFAULT 524288,
          status TEXT NOT NULL DEFAULT 'pending',
          error TEXT,
          file_count INTEGER NOT NULL DEFAULT 0,
          last_indexed_at TEXT,
          last_duration_ms INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY,
          root_id TEXT NOT NULL REFERENCES index_roots(id) ON DELETE CASCADE,
          rel_path TEXT NOT NULL,
          name TEXT NOT NULL,
          ext TEXT NOT NULL DEFAULT '',
          dir TEXT NOT NULL DEFAULT '',
          size INTEGER NOT NULL,
          mtime_ms INTEGER NOT NULL,
          is_binary INTEGER NOT NULL DEFAULT 0,
          content_indexed INTEGER NOT NULL DEFAULT 0,
          indexed_at TEXT NOT NULL,
          UNIQUE(root_id, rel_path)
        );
        CREATE INDEX IF NOT EXISTS idx_files_root ON files(root_id);
        CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);

        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
          name, rel_path,
          content='files',
          content_rowid='id',
          tokenize='trigram'
        );

        CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
          INSERT INTO files_fts(rowid, name, rel_path)
          VALUES (NEW.id, NEW.name, NEW.rel_path);
        END;

        CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
          INSERT INTO files_fts(files_fts, rowid, name, rel_path)
          VALUES ('delete', OLD.id, OLD.name, OLD.rel_path);
        END;

        CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE OF name, rel_path ON files BEGIN
          INSERT INTO files_fts(files_fts, rowid, name, rel_path)
          VALUES ('delete', OLD.id, OLD.name, OLD.rel_path);
          INSERT INTO files_fts(rowid, name, rel_path)
          VALUES (NEW.id, NEW.name, NEW.rel_path);
        END;

        CREATE VIRTUAL TABLE IF NOT EXISTS file_content_fts USING fts5(
          body,
          content='',
          contentless_delete=1,
          tokenize='trigram'
        );
      `);
    },
  },
  {
    version: 2,
    description: "Local file index filter indexes",
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_root_ext ON files(root_id, ext);
        CREATE INDEX IF NOT EXISTS idx_files_root_dir ON files(root_id, dir);
      `);
    },
  },
  {
    version: 3,
    description: "Local content short-token filter grams",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_content_grams (
          file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          gram TEXT NOT NULL,
          PRIMARY KEY (file_id, gram)
        );
        CREATE INDEX IF NOT EXISTS idx_file_content_grams_gram_file
          ON file_content_grams(gram, file_id);
      `);
    },
  },
  {
    version: 4,
    description: "Index run start marker so a killed indexer is detectable",
    up: (db) => {
      const columns = db.query("PRAGMA table_info(index_roots)").all() as Array<{ name: string }>;
      if (!columns.some((c) => c.name === "indexing_started_at")) {
        db.exec("ALTER TABLE index_roots ADD COLUMN indexing_started_at TEXT");
      }
      // Rows already stuck at 'indexing' predate the marker; leaving them with a
      // NULL start time is what makes them classify as wedged (not running), so
      // the recovery path picks them up instead of skipping them forever.
    },
  },
];

export function runIndexMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .query("SELECT version FROM _migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    db.exec("BEGIN");
    try {
      migration.up(db);
      db.prepare("INSERT OR IGNORE INTO _migrations (version, description) VALUES (?, ?)").run(
        migration.version,
        migration.description,
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
