/**
 * Fail-closed: the two on-box stores that used to bypass `getDatabase()`'s
 * gate — the storage-sync local adapter and the session registry — must not
 * open or create ANY file on the hosted route (a credential configured, no
 * local opt-in), and must never touch the home root (T1 §3.5 mementos:
 * `storage-sync.ts` `new SqliteAdapter(getDbPath())`; `session-registry.ts`
 * `~/.open-sessions-registry.db`).
 *
 * The env is scrubbed and pinned BEFORE the modules load: a scratch HOME, a
 * hosted authority + key in the env (so `hasMementosEnvAuthorityIntent` is
 * true and the opt-in cannot fire), no DB_PATH, no local flag, no server
 * context. Nothing here contacts the network — the registry and the sync
 * status are answered (or refused) before any transport is built.
 */
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRATCH_HOME = mkdtempSync(join(tmpdir(), "mementos-hosted-route-"));
process.env["HOME"] = SCRATCH_HOME;
process.env["HASNA_STATION"] = "no-such-station";
process.env["HASNA_MEMENTOS_API_URL"] = "https://api.hasna.com/mementos";
process.env["HASNA_MEMENTOS_API_KEY"] = "hk_test_not_a_real_key_0000000000000000";
for (const key of [
  "HASNA_MEMENTOS_LOCAL",
  "MEMENTOS_LOCAL",
  "HASNA_MEMENTOS_DB_PATH",
  "MEMENTOS_DB_PATH",
  "HASNA_MEMENTOS_DATABASE_URL",
  "MEMENTOS_DATABASE_URL",
  "HASNA_MEMENTOS_HOME",
  "MEMENTOS_HOME",
]) delete process.env[key];

import { afterAll, describe, expect, test } from "bun:test";
import { resetServerContextForTests } from "../storage.js";
import { STORAGE_SYNC_LOCAL_ONLY_MESSAGE, getStorageSyncStatus, pushStorageChanges } from "./storage-sync.js";
import {
  __resetProcessLocalRegistry,
  closeRegistry,
  getSession,
  listSessions,
  registerSession,
  sessionRegistryUsesLocalStore,
  unregisterSession,
} from "./session-registry.js";

function dbFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(d, name);
      let isDir = false;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(p);
      else if (/\.db(-wal|-shm|-journal)?$/.test(name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

afterAll(() => {
  closeRegistry();
  __resetProcessLocalRegistry();
  resetServerContextForTests();
});

describe("hosted route: no on-box store is opened or created", () => {
  test("the environment selects the hosted route, not the local store", () => {
    resetServerContextForTests();
    expect(sessionRegistryUsesLocalStore(process.env)).toBe(false);
  });

  test("storage sync status refuses with REMOTE_COMMAND_UNSUPPORTED and names the opt-in, creating nothing", () => {
    resetServerContextForTests();
    expect(() => getStorageSyncStatus()).toThrow(STORAGE_SYNC_LOCAL_ONLY_MESSAGE);
    expect(STORAGE_SYNC_LOCAL_ONLY_MESSAGE.startsWith("REMOTE_COMMAND_UNSUPPORTED:")).toBe(true);
    expect(STORAGE_SYNC_LOCAL_ONLY_MESSAGE).toContain("HASNA_MEMENTOS_LOCAL=1");
    expect(STORAGE_SYNC_LOCAL_ONLY_MESSAGE).toContain("HASNA_MEMENTOS_DB_PATH");
    expect(STORAGE_SYNC_LOCAL_ONLY_MESSAGE).not.toContain("hk_test");
    expect(dbFilesUnder(SCRATCH_HOME)).toEqual([]);
  });

  test("storage push refuses before touching a remote or a local file", () => {
    resetServerContextForTests();
    // With no DSN configured the pre-existing "remote not configured" refusal
    // fires first; with a DSN it must be OUR refusal that fires, and neither
    // path may create a file.
    expect(() => pushStorageChanges()).toThrow();
    process.env["HASNA_MEMENTOS_DATABASE_URL"] = "postgres://user:pw@127.0.0.1:1/never";
    try {
      expect(() => pushStorageChanges()).toThrow(STORAGE_SYNC_LOCAL_ONLY_MESSAGE);
    } finally {
      delete process.env["HASNA_MEMENTOS_DATABASE_URL"];
    }
    expect(dbFilesUnder(SCRATCH_HOME)).toEqual([]);
  });

  test("the session registry works process-locally and writes no file anywhere under HOME", () => {
    resetServerContextForTests();
    const session = registerSession({ mcp_server: "mementos-hosted-test", project_name: "p" });
    expect(session.id).toBeString();
    expect(session.pid).toBe(process.pid);
    expect(getSession(session.id)?.project_name).toBe("p");
    // Same PID + server = same session (upsert semantics preserved).
    const again = registerSession({ mcp_server: "mementos-hosted-test", project_name: "q" });
    expect(again.id).toBe(session.id);
    expect(listSessions({ mcp_server: "mementos-hosted-test" }).map((s) => s.project_name)).toEqual(["q"]);
    unregisterSession(session.id);
    expect(getSession(session.id)).toBeNull();
    expect(dbFilesUnder(SCRATCH_HOME)).toEqual([]);
  });
});
