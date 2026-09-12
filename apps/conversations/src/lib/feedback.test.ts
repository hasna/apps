// Ordinary feedback clients require shared credentials; explicit library storage stays separately tested.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "./db.js";
import { saveFeedbackLocal } from "./feedback.js";
import { ConversationsStoreConfigError, getStore } from "./store/index.js";
import { LocalStore } from "./store/local-store.js";
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

describe("saveFeedback (store-routed surface)", () => {
  test("nothing configured: requires shared API credentials and opens nothing", async () => {
    let message: string;
    try {
      // getStore() itself throws synchronously for a config refusal, so the
      // rejection must be caught around the whole call.
      message = await getStore().saveFeedback({ message: "no store configured" }).then(() => "unexpected success");
    } catch (error) {
      expect(error).toBeInstanceOf(ConversationsStoreConfigError);
      message = (error as Error).message;
    }
    expect(message).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(message).not.toMatch(/-local-fallback/i);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("hosted with a credential routes to the hosted feedback route, never the on-box store", async () => {
    process.env.HASNA_CONVERSATIONS_API_KEY = ["fixture", "not", "a", "credential"].join("-");
    // Loopback URL keeps the test-context guard satisfied; the refused port
    // makes the hosted write fail fast instead of reaching the fleet.
    process.env.HASNA_CONVERSATIONS_API_URL = "http://127.0.0.1:9";
    await expect(getStore().saveFeedback({ message: "hosted feedback write" })).rejects.toThrow();
    // The failure is a hosted transport failure, not a silent local write.
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("explicit LocalStore library saves the entry into its named store", async () => {
    const dbPath = join(tempRoot, "store.db");
    process.env.HASNA_CONVERSATIONS_DB_PATH = dbPath;
    const saved = await new LocalStore().saveFeedback({ message: "hello", email: "someone@example.invalid", category: "bug" });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.sent).toBe(true);
    expect(saved.error).toBeNull();
    expect(existsSync(dbPath)).toBe(true);
    // Only the store the operator named was opened.
    expect(sqliteFilesUnder(tempRoot).every((file) => file.startsWith(dbPath))).toBe(true);
  });

  test("saveFeedbackLocal writes the on-box row directly", () => {
    const dbPath = join(tempRoot, "local.db");
    process.env.HASNA_CONVERSATIONS_DB_PATH = dbPath;
    const saved = saveFeedbackLocal({ message: "direct local write" });
    expect(saved.sent).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
  });
});