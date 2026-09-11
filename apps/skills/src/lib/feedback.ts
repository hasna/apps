import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { getDataDir } from "./config.js";
import { createRemoteSkillsClient } from "./remote-client.js";

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
  /** Where the report went: the configured instance, or this machine. */
  target: "hosted" | "local";
  /** The instance's id for the stored report. Hosted sends only. */
  id?: string;
  /** When the instance recorded it (ISO 8601). Hosted sends only. */
  createdAt?: string;
  /** The local database the report was written to. Local opt-in sends only. */
  path?: string;
}

/**
 * Resolved via getDataDir() rather than homedir() so that it agrees with the
 * path the local database actually uses. While this read the home directly,
 * setting $HASNA_SKILLS_DIR made the reported path and the written path
 * diverge - the CLI would name a database it was not using.
 */
export function getFeedbackDbPath(): string {
  return join(getDataDir(), "skills.db");
}

/**
 * Send feedback.
 *
 * On any install with a resolved Skills credential this is a POST to
 * `/api/v1/feedback` on the configured instance. That route is new: this
 * surface used to have no hosted arm at all, so a keyed station appended the
 * report to `~/.hasna/skills/feedback.jsonl` and a local install inserted it
 * into `~/.hasna/skills/skills.db`. Both said "saved" and left the message on
 * one machine, where nobody who could act on it would ever read it.
 *
 * The SQLite arm below is now reachable ONLY under the explicit local opt-in
 * (`HASNA_SKILLS_LOCAL=1`): `createRemoteSkillsClient()` returns null in that
 * mode and only that mode - with no credential, no authority and no opt-in the
 * shared ladder throws, so an unconfigured install fails closed here too
 * instead of quietly writing a database.
 *
 * ASYNC because both of those are: the credential ladder may complete a vault
 * pointer, and the send is an HTTP request.
 */
export async function saveFeedback(
  input: FeedbackInput,
  env: Record<string, string | undefined> = process.env,
): Promise<FeedbackResult> {
  const message = input.message.trim();
  if (!message) throw new Error("Feedback message is required");

  const category = input.category ?? "general";
  const client = await createRemoteSkillsClient(env);
  if (client) {
    const stored = await client.sendFeedback({
      message,
      category,
      ...(input.email ? { email: input.email } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
      ...(input.version ? { version: input.version } : {}),
    });
    return { saved: true, category, target: "hosted", id: stored.id, createdAt: stored.createdAt };
  }

  return saveFeedbackLocally({ ...input, message, category });
}

/**
 * The local opt-in arm. `bun:sqlite` is imported here, lazily, rather than at
 * module scope: this module is reachable from the CLI and MCP bins, and a
 * top-level import put the SQLite driver in both bundles for a surface a
 * hosted install must never reach.
 */
async function saveFeedbackLocally(input: FeedbackInput & { category: FeedbackCategory }): Promise<FeedbackResult> {
  const { Database } = await import("bun:sqlite");
  const dbPath = getFeedbackDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  try {
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
    db.run(
      "INSERT INTO feedback (message, email, category, agent, version) VALUES (?, ?, ?, ?, ?)",
      [input.message, input.email || null, input.category, input.agent || null, input.version || null],
    );
  } finally {
    db.close();
  }
  return { saved: true, category: input.category, target: "local", path: dbPath };
}
