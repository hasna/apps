// `send_feedback` is a LOCAL-ONLY surface, and local is an explicit opt-in.
//
// The MCP tool used to call `getDb()` unconditionally, so on a hosted station
// — every other tool routed to the fleet through `getStore()` — one feedback
// call silently created `~/.hasna/conversations/messages.db` (plus WAL/SHM)
// and wrote into it. Hosted with no opt-in must refuse, naming the opt-in, and
// create NOTHING (hasna/apps#1720 validation, acceptance (c) and (f)).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "./db.js";
import { saveFeedback } from "./feedback.js";
import { ConversationsStoreConfigError } from "./store/index.js";
import { enterHermeticTestEnv } from "../test/hermetic.js";

const HOME_KEYS = ["HOME", "HASNA_HOME", "HASNA_CONVERSATIONS_HOME", "CONVERSATIONS_HOME"] as const;

let tempRoot: string;
let restoreAmbient: () => void;
let savedHomes: Map<string, string | undefined>;

/** Recursively list every *.db / *.sqlite / *.sqlite3 (and -wal/-shm) file under a root. */
function sqliteFilesUnder(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
    else if (/\.(?:db|sqlite3?)(?:-wal|-shm)?$/.test(entry.name)) out.push(full);
  }
  return out;
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "conversations-feedback-"));
  // Everything the app could anchor a data dir or a credential file on points
  // into the scratch root; the Keychain is pinned to a station no item uses.
  savedHomes = new Map(HOME_KEYS.map((key) => [key, process.env[key]]));
  restoreAmbient = enterHermeticTestEnv();
  process.env.HOME = tempRoot;
  process.env.HASNA_HOME = join(tempRoot, ".hasna");
  process.env.HASNA_CONVERSATIONS_HOME = join(tempRoot, ".hasna", "conversations");
  delete process.env.CONVERSATIONS_HOME;
  closeDb();
});

afterEach(() => {
  closeDb();
  restoreAmbient();
  for (const [key, value] of savedHomes) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("saveFeedback (local-only surface)", () => {
  test("hosted with no credential and no opt-in: refuses naming HASNA_CONVERSATIONS_DB_PATH, opens nothing", () => {
    let caught: unknown;
    try {
      saveFeedback("the hosted station must not grow a local db");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConversationsStoreConfigError);
    const message = (caught as Error).message;
    expect(message).toContain("send_feedback");
    expect(message).toContain("HASNA_CONVERSATIONS_DB_PATH");
    expect(message).not.toMatch(/-local-fallback/i);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("hosted WITH a credential still refuses: there is no hosted feedback transport, and no local side door", () => {
    process.env.HASNA_CONVERSATIONS_API_KEY = ["fixture", "not", "a", "credential"].join("-");
    expect(() => saveFeedback("still no local db")).toThrow(ConversationsStoreConfigError);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("the explicit local opt-in saves the entry into the named store", () => {
    const dbPath = join(tempRoot, "store.db");
    process.env.HASNA_CONVERSATIONS_DB_PATH = dbPath;
    const saved = saveFeedback("hello", "someone@example.invalid");
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.sent).toBe(false);
    expect(existsSync(dbPath)).toBe(true);
    // Only the store the operator named was opened.
    expect(sqliteFilesUnder(tempRoot).every((file) => file.startsWith(dbPath))).toBe(true);
  });
});
