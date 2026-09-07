import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { Database } from "bun:sqlite";
import { resolveApiUrl } from "./api-url.js";
import { getDataDir } from "./config.js";

export type FeedbackCategory = "bug" | "feature" | "general";

export interface FeedbackInput {
  message: string;
  category?: FeedbackCategory;
  email?: string;
  agent?: string;
  version?: string;
}

export interface FeedbackResult {
  saved: true;
  category: FeedbackCategory;
  path: string;
}

/**
 * Resolved via getDataDir() rather than homedir() so that it agrees with the
 * path `skills storage` advertises (native-storage.ts builds `feedbackDbPath`
 * from getDataDir()). While this read the home directly, setting
 * $HASNA_SKILLS_DIR made the reported path and the written path diverge - the
 * CLI would name a database it was not using.
 */
export function getFeedbackDbPath(): string {
  return join(getDataDir(), "skills.db");
}

function getFeedbackDb(): Database {
  const dbPath = getFeedbackDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec([
    "CREATE TABLE IF NOT EXISTS feedback (",
    "id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),",
    "message TEXT NOT NULL,",
    "email TEXT,",
    "category TEXT DEFAULT 'general',",
    "agent TEXT,",
    "version TEXT,",
    "machine_id TEXT,",
    "created_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ")",
  ].join(" "));
  try {
    db.exec("ALTER TABLE feedback ADD COLUMN agent TEXT");
  } catch {}
  return db;
}

export function saveFeedback(input: FeedbackInput): FeedbackResult {
  const message = input.message.trim();
  if (!message) throw new Error("Feedback message is required");

  const category = input.category ?? "general";
  // Feedback records to ONE store in every transport: the on-box SQLite
  // database (the legacy api-mode JSONL branch was a storage-mode leftover —
  // the storage-mode axis is retired and feedback must behave the same whether
  // or not a Skills credential resolves).
  const db = getFeedbackDb();
  try {
    db.run(
      "INSERT INTO feedback (message, email, category, agent, version) VALUES (?, ?, ?, ?, ?)",
      [message, input.email || null, category, input.agent || null, input.version || null]
    );
  } finally {
    db.close();
  }
  return { saved: true, category, path: getFeedbackDbPath() };
}

/**
 * True when this install talks to a Skills instance — i.e. a credential
 * resolves on the shared fleet ladder (lib/fleet-credentials.ts).
 *
 * Kept as the read-only signal used by surfaces that report where feedback is
 * recorded; the record itself no longer branches on it (the storage-mode axis
 * is retired). The check never throws: a half-configured ladder is reported as
 * false rather than crashing the command.
 */
export function isApiMode(env: Record<string, string | undefined> = process.env): boolean {
  try {
    return Boolean(resolveApiUrl(env));
  } catch {
    return false;
  }
}
