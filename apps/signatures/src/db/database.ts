import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

type QueryResult<T> = {
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
  run(...params: unknown[]): unknown;
};

export type SignaturesDatabase = Omit<Database, "query"> & {
  query<T = unknown, P extends unknown[] = unknown[]>(sql: string): {
    get(...params: P): T | undefined;
    all(...params: P): T[];
    run(...params: P): unknown;
  };
};

let db: SignaturesDatabase | null = null;

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

function getDbPath(): string {
  if (process.env["HASNA_SIGNATURES_DB_PATH"]) {
    return process.env["HASNA_SIGNATURES_DB_PATH"];
  }
  if (process.env["SIGNATURES_DB_PATH"]) {
    return process.env["SIGNATURES_DB_PATH"];
  }

  const home = homeDir();

  // Check for git root .signatures/ (project-scoped, unchanged)
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, ".git"))) {
      const localPath = join(dir, ".signatures", "signatures.db");
      mkdirSync(dirname(localPath), { recursive: true });
      return localPath;
    }
    if (dir === home) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const newPath = join(home, ".hasna", "signatures", "signatures.db");
  const legacyPath = join(home, ".signatures", "signatures.db");

  if (!existsSync(newPath) && existsSync(legacyPath)) {
    mkdirSync(dirname(newPath), { recursive: true });
    copyFileSync(legacyPath, newPath);
  }

  mkdirSync(dirname(newPath), { recursive: true });
  return newPath;
}

export function getDatabase(): SignaturesDatabase {
  if (db) return db;

  const path = getDbPath();

  db = new Database(path) as unknown as SignaturesDatabase;
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  runMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(database: SignaturesDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    database
      .query<{ name: string }, []>("SELECT name FROM migrations")
      .all()
      .map((r: { name: string }) => r.name)
  );

  for (const [name, sql] of MIGRATIONS) {
    if (!applied.has(name)) {
      database.exec(sql);
      database
        .query("INSERT INTO migrations (name) VALUES (?)")
        .run(name);
    }
  }
}

const MIGRATIONS: [string, string][] = [
  [
    "001_initial_schema",
    `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf',
      status TEXT NOT NULL DEFAULT 'draft',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_tags (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (document_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS signatures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      font_family TEXT,
      font_size INTEGER NOT NULL DEFAULT 48,
      color TEXT NOT NULL DEFAULT '#000000',
      text_value TEXT,
      image_path TEXT,
      image_prompt TEXT,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signature_fields (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL,
      height REAL,
      field_type TEXT NOT NULL DEFAULT 'signature',
      label TEXT,
      required INTEGER NOT NULL DEFAULT 1,
      detected INTEGER NOT NULL DEFAULT 0,
      assigned_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signature_placements (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      signature_id TEXT NOT NULL REFERENCES signatures(id) ON DELETE CASCADE,
      field_id TEXT REFERENCES signature_fields(id) ON DELETE SET NULL,
      page INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL,
      height REAL,
      signed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signing_sessions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      signer_name TEXT,
      signer_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      token TEXT UNIQUE NOT NULL,
      source TEXT NOT NULL DEFAULT 'local',
      connector_name TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      id UNINDEXED,
      name,
      description,
      file_name,
      content='documents',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, id, name, description, file_name)
      VALUES (new.rowid, new.id, new.name, new.description, new.file_name);
    END;

    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, id, name, description, file_name)
      VALUES ('delete', old.rowid, old.id, old.name, old.description, old.file_name);
      INSERT INTO documents_fts(rowid, id, name, description, file_name)
      VALUES (new.rowid, new.id, new.name, new.description, new.file_name);
    END;

    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, id, name, description, file_name)
      VALUES ('delete', old.rowid, old.id, old.name, old.description, old.file_name);
    END;

    CREATE VIRTUAL TABLE IF NOT EXISTS signatures_fts USING fts5(
      id UNINDEXED,
      name,
      text_value,
      content='signatures',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS signatures_ai AFTER INSERT ON signatures BEGIN
      INSERT INTO signatures_fts(rowid, id, name, text_value)
      VALUES (new.rowid, new.id, new.name, new.text_value);
    END;

    CREATE TRIGGER IF NOT EXISTS signatures_au AFTER UPDATE ON signatures BEGIN
      INSERT INTO signatures_fts(signatures_fts, rowid, id, name, text_value)
      VALUES ('delete', old.rowid, old.id, old.name, old.text_value);
      INSERT INTO signatures_fts(rowid, id, name, text_value)
      VALUES (new.rowid, new.id, new.name, new.text_value);
    END;

    CREATE TRIGGER IF NOT EXISTS signatures_ad AFTER DELETE ON signatures BEGIN
      INSERT INTO signatures_fts(signatures_fts, rowid, id, name, text_value)
      VALUES ('delete', old.rowid, old.id, old.name, old.text_value);
    END;
    `,
  ],
  [
    "003_settings",
    `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
  ],
  [
    "004a_signing_session_attachment_id",
    `ALTER TABLE signing_sessions ADD COLUMN attachment_id TEXT`,
  ],
  [
    "004b_signing_session_share_link",
    `ALTER TABLE signing_sessions ADD COLUMN share_link TEXT`,
  ],
  [
    "004c_signing_session_share_expires_at",
    `ALTER TABLE signing_sessions ADD COLUMN share_expires_at TEXT`,
  ],
  [
    "005_feedback",
    `CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), message TEXT NOT NULL, email TEXT, category TEXT DEFAULT 'general', version TEXT, machine_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));`,
  ],
  [
    "006a_people",
    `
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      role TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS people_email_unique
      ON people(email)
      WHERE email IS NOT NULL AND email != '';
    `,
  ],
  [
    "006b_signature_field_geometry",
    `ALTER TABLE signature_fields ADD COLUMN unit TEXT NOT NULL DEFAULT 'percent'`,
  ],
  [
    "006c_signature_field_anchor",
    `ALTER TABLE signature_fields ADD COLUMN anchor TEXT`,
  ],
  [
    "006d_signing_session_person_id",
    `ALTER TABLE signing_sessions ADD COLUMN person_id TEXT`,
  ],
  [
    "006e_signing_session_signing_url",
    `ALTER TABLE signing_sessions ADD COLUMN signing_url TEXT`,
  ],
  [
    "006f_signing_session_signed_document_path",
    `ALTER TABLE signing_sessions ADD COLUMN signed_document_path TEXT`,
  ],
  [
    "006g_signing_session_certificate_path",
    `ALTER TABLE signing_sessions ADD COLUMN certificate_path TEXT`,
  ],
  [
    "006h_signing_session_completed_at",
    `ALTER TABLE signing_sessions ADD COLUMN completed_at TEXT`,
  ],
  [
    "006i_signing_session_signature_level",
    `ALTER TABLE signing_sessions ADD COLUMN signature_level TEXT NOT NULL DEFAULT 'ses'`,
  ],
  [
    "006j_signing_session_assurance_level",
    `ALTER TABLE signing_sessions ADD COLUMN assurance_level TEXT`,
  ],
  [
    "006k_signing_session_provider_status",
    `ALTER TABLE signing_sessions ADD COLUMN provider_status TEXT`,
  ],
  [
    "006l_signing_session_validation_status",
    `ALTER TABLE signing_sessions ADD COLUMN validation_status TEXT`,
  ],
  [
    "006m_signing_session_signer_type",
    `ALTER TABLE signing_sessions ADD COLUMN signer_type TEXT NOT NULL DEFAULT 'human'`,
  ],
  [
    "006n_signing_session_agent_id",
    `ALTER TABLE signing_sessions ADD COLUMN agent_id TEXT`,
  ],
  [
    "006o_signing_session_agent_provider",
    `ALTER TABLE signing_sessions ADD COLUMN agent_provider TEXT`,
  ],
  [
    "006p_signing_session_agent_run_id",
    `ALTER TABLE signing_sessions ADD COLUMN agent_run_id TEXT`,
  ],
  [
    "006q_signing_session_agent_thread_id",
    `ALTER TABLE signing_sessions ADD COLUMN agent_thread_id TEXT`,
  ],
  [
    "006r_signing_session_agent_policy_id",
    `ALTER TABLE signing_sessions ADD COLUMN agent_policy_id TEXT`,
  ],
  [
    "006s_signing_session_agent_reason",
    `ALTER TABLE signing_sessions ADD COLUMN agent_reason TEXT`,
  ],
  [
    "006t_signing_session_signing_order",
    `ALTER TABLE signing_sessions ADD COLUMN signing_order INTEGER NOT NULL DEFAULT 1`,
  ],
  [
    "006u_signing_session_parallel_group",
    `ALTER TABLE signing_sessions ADD COLUMN parallel_group INTEGER NOT NULL DEFAULT 1`,
  ],
  [
    "006v_signing_session_recipient_status",
    `ALTER TABLE signing_sessions ADD COLUMN recipient_status TEXT NOT NULL DEFAULT 'pending'`,
  ],
  [
    "006w_people_signer_type",
    `ALTER TABLE people ADD COLUMN signer_type TEXT NOT NULL DEFAULT 'human'`,
  ],
  [
    "006x_people_agent_id",
    `ALTER TABLE people ADD COLUMN agent_id TEXT`,
  ],
  [
    "006y_people_agent_provider",
    `ALTER TABLE people ADD COLUMN agent_provider TEXT`,
  ],
  [
    "006y1_people_agent_id_unique",
    `CREATE UNIQUE INDEX IF NOT EXISTS people_agent_id_unique
      ON people(agent_id)
      WHERE agent_id IS NOT NULL AND agent_id != ''`,
  ],
  [
    "006z01_signature_field_signer_type",
    `ALTER TABLE signature_fields ADD COLUMN signer_type TEXT NOT NULL DEFAULT 'human'`,
  ],
  [
    "006z02_signature_field_role",
    `ALTER TABLE signature_fields ADD COLUMN role TEXT`,
  ],
  [
    "006z03_signature_field_signing_order",
    `ALTER TABLE signature_fields ADD COLUMN signing_order INTEGER NOT NULL DEFAULT 1`,
  ],
  [
    "006z04_signature_field_parallel_group",
    `ALTER TABLE signature_fields ADD COLUMN parallel_group INTEGER NOT NULL DEFAULT 1`,
  ],
  [
    "006z05_signature_field_recipient_status",
    `ALTER TABLE signature_fields ADD COLUMN recipient_status TEXT NOT NULL DEFAULT 'pending'`,
  ],
  [
    "006z06_signing_session_agent_input_hash",
    `ALTER TABLE signing_sessions ADD COLUMN agent_input_hash TEXT`,
  ],
  [
    "006z07_signing_session_agent_output_hash",
    `ALTER TABLE signing_sessions ADD COLUMN agent_output_hash TEXT`,
  ],
  [
    "006z08_signing_session_field_id",
    `ALTER TABLE signing_sessions ADD COLUMN field_id TEXT`,
  ],
  [
    "006z09_signing_session_role",
    `ALTER TABLE signing_sessions ADD COLUMN role TEXT`,
  ],
  [
    "007_audit_events",
    `
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES signing_sessions(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      message TEXT,
      actor_name TEXT,
      actor_email TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
  ],
  [
    "007a_audit_event_actor_signer_type",
    `ALTER TABLE audit_events ADD COLUMN actor_signer_type TEXT`,
  ],
  [
    "007b_audit_event_actor_agent_id",
    `ALTER TABLE audit_events ADD COLUMN actor_agent_id TEXT`,
  ],
  [
    "008_signing_certificates",
    `
    CREATE TABLE IF NOT EXISTS signing_certificates (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES signing_sessions(id) ON DELETE CASCADE,
      certificate_path TEXT NOT NULL,
      original_document_hash TEXT,
      signed_document_hash TEXT,
      verification_code TEXT NOT NULL UNIQUE,
      metadata TEXT,
      issued_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
  ],
  [
    "009_provider_evidence",
    `
    CREATE TABLE IF NOT EXISTS provider_evidence (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES signing_sessions(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      connector_slug TEXT,
      operation TEXT,
      signature_level TEXT NOT NULL DEFAULT 'ses',
      status TEXT NOT NULL DEFAULT 'prepared',
      validation_status TEXT NOT NULL DEFAULT 'pending',
      remote_document_id TEXT,
      remote_status TEXT,
      request TEXT,
      response TEXT,
      evidence TEXT,
      original_document_hash TEXT,
      signed_document_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS provider_evidence_document_idx ON provider_evidence(document_id);
    CREATE INDEX IF NOT EXISTS provider_evidence_session_idx ON provider_evidence(session_id);
    `,
  ],
  [
    "010_provider_evidence_signature_level_cleanup",
    `UPDATE provider_evidence SET signature_level = 'ses' WHERE signature_level = 'provider' OR signature_level IS NULL`,
  ],
  [
    "011a_provider_evidence_signer_type",
    `ALTER TABLE provider_evidence ADD COLUMN signer_type TEXT`,
  ],
  [
    "011b_provider_evidence_recipient_role",
    `ALTER TABLE provider_evidence ADD COLUMN recipient_role TEXT`,
  ],
];
