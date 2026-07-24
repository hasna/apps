import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserContext } from "playwright";

import { createSession } from "../db/sessions.js";
import { getDataDir, getDatabase, resetDatabase } from "../db/schema.js";
import { getConsoleLog, logConsoleMessage } from "../db/console-log.js";
import { getNetworkLog, logRequest } from "../db/network-log.js";
import { auditBrowserStorageSecurity } from "./security.js";
import { loadState, saveState } from "./storage-state.js";

let tmpDir: string;
const savedEnv = new Map<string, string | undefined>();
const envKeys = [
  "BROWSER_DATA_DIR",
  "BROWSER_DB_PATH",
  "BROWSER_PERSIST_RAW_NETWORK_HEADERS",
  "BROWSER_PERSIST_RAW_NETWORK_BODY",
  "BROWSER_PERSIST_URL_QUERY",
  "BROWSER_CONSOLE_MAX_CHARS",
] as const;

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "browser-security-test-"));
  savedEnv.clear();
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "browser.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("browser local storage security", () => {
  test("creates data directory and browser DB with owner-only modes", () => {
    getDatabase();

    if (process.platform !== "win32") {
      expect(mode(getDataDir())).toBe(0o700);
      expect(mode(join(tmpDir, "browser.db"))).toBe(0o600);
    }
  });

  test("saves Playwright storage state as encrypted owner-only JSON", async () => {
    const context = {
      storageState: async () => ({
        cookies: [{
          name: "session",
          value: "synthetic-cookie",
          domain: "example.test",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        }],
        origins: [],
      }),
    } as unknown as BrowserContext;

    const legacyPath = join(tmpDir, "states", "example.json");
    mkdirSync(join(tmpDir, "states"), { recursive: true, mode: 0o700 });
    writeFileSync(legacyPath, `${JSON.stringify({ cookies: [{ value: "legacy-cookie" }], origins: [] })}\n`, { mode: 0o600 });

    const path = await saveState(context, "example");

    expect(path.endsWith(".json.enc")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(legacyPath)).toBe(false);
    expect(readFileSync(path, "utf8")).not.toContain("synthetic-cookie");
    expect(readFileSync(path, "utf8")).not.toContain("legacy-cookie");
    expect(loadState("example")?.cookies[0]?.name).toBe("session");
    if (process.platform !== "win32") expect(mode(path)).toBe(0o600);
  });

  test("redacts and minimizes network and console DB writes by default", () => {
    const session = createSession({ engine: "playwright" });

    logRequest({
      session_id: session.id,
      method: "POST",
      url: "https://example.test/login?token=query-token&ok=1#frag",
      status_code: 200,
      request_headers: JSON.stringify({ authorization: "Bearer abc.def.ghi", accept: "application/json" }),
      response_headers: JSON.stringify({ "set-cookie": "sid=synthetic" }),
      request_body: "password=synthetic",
      resource_type: "xhr",
    });
    logConsoleMessage({
      session_id: session.id,
      level: "error",
      message: "Authorization Bearer abc.def.ghi failed",
      source: "https://example.test/app.js?token=query-token",
    });

    const request = getNetworkLog(session.id)[0];
    expect(request.url).toBe("https://example.test/login");
    expect(request.request_headers).toBeNull();
    expect(request.response_headers).toBeNull();
    expect(request.request_body).toBeNull();

    const message = getConsoleLog(session.id)[0];
    expect(message.message).toContain("Bearer [redacted]");
    expect(message.message).not.toContain("abc.def.ghi");
    expect(message.source).toBe("https://example.test/app.js");
  });

  test("drift guard reports counts and apply repairs without printing values", () => {
    const db = getDatabase();
    const session = createSession({ engine: "playwright" });
    const statesDir = join(tmpDir, "states");
    mkdirSync(statesDir, { recursive: true, mode: 0o777 });
    const plaintextState = join(statesDir, "plain.json");
    writeFileSync(plaintextState, `${JSON.stringify({ cookies: [], origins: [] })}\n`, { mode: 0o664 });
    db.prepare(`
      INSERT INTO network_log (id, session_id, method, url, request_headers, response_headers, request_body)
      VALUES ('raw-row', ?, 'GET', 'https://example.test/path?token=query-token', ?, ?, ?)
    `).run(
      session.id,
      JSON.stringify({ authorization: "Bearer abc.def.ghi" }),
      JSON.stringify({ "set-cookie": "sid=synthetic" }),
      "password=synthetic",
    );

    const dryRun = auditBrowserStorageSecurity(tmpDir, db);
    expect(dryRun.applied).toBe(false);
    expect(dryRun.counts.plaintextAuthStateFiles).toBeGreaterThanOrEqual(1);
    expect(dryRun.counts.rawNetworkRows).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(dryRun)).not.toContain("abc.def.ghi");
    expect(JSON.stringify(dryRun)).not.toContain("query-token");

    const applied = auditBrowserStorageSecurity(tmpDir, db, { apply: true });
    expect(applied.applied).toBe(true);
    expect(existsSync(plaintextState)).toBe(false);
    expect(existsSync(`${plaintextState}.enc`)).toBe(true);
    const row = db.query<{ url: string; request_headers: string | null; request_body: string | null }, []>(
      "SELECT url, request_headers, request_body FROM network_log WHERE id = 'raw-row'"
    ).get();
    expect(row?.url).toBe("https://example.test/path");
    expect(row?.request_headers).toBeNull();
    expect(row?.request_body).toBeNull();
  });

  test("retention apply does not prune fresh SQLite datetime rows", () => {
    const db = getDatabase();
    const session = createSession({ engine: "playwright" });
    db.prepare(`
      INSERT INTO network_log (id, session_id, method, url)
      VALUES ('fresh-row', ?, 'GET', 'https://example.test/fresh')
    `).run(session.id);

    const applied = auditBrowserStorageSecurity(tmpDir, db, { apply: true, retentionHours: 1 });
    expect(applied.counts.expiredNetworkRows).toBe(0);
    const row = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM network_log WHERE id = 'fresh-row'").get();
    expect(row?.count).toBe(1);
  });
});
