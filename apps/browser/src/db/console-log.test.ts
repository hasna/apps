/**
 * Tests for the console-log store (src/db/console-log.ts): message
 * recording, level filtering, chronological ordering, clearing, and the
 * persistence sanitization applied to stored message text.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDatabase } from "./schema.js";
import { createSession } from "./sessions.js";
import { logConsoleMessage, getConsoleMessage, getConsoleLog, clearConsoleLog } from "./console-log.js";

let tmpDir: string;
let sid1: string;
let sid2: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "console-log-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
  // session_id is FK-constrained to sessions(id)
  sid1 = createSession({ engine: "playwright" }).id;
  sid2 = createSession({ engine: "playwright" }).id;
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("console log", () => {
  it("records a message and reads it back", () => {
    const msg = logConsoleMessage({
      session_id: sid1,
      level: "error",
      message: "Cannot read properties of undefined",
      source: "webpack:///app.js",
      line_number: 42,
    });
    expect(msg.id).toBeTruthy();
    expect(msg.level).toBe("error");
    expect(msg.message).toBe("Cannot read properties of undefined");

    const fetched = getConsoleMessage(msg.id);
    // source goes through sanitizeUrlForPersistence: the unknown webpack: scheme is redacted
    expect(fetched?.source).toBe("webpack:[redacted]");
    expect(fetched?.line_number).toBe(42);
  });

  it("returns null for an unknown message id", () => {
    expect(getConsoleMessage("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("filters by level", () => {
    logConsoleMessage({ session_id: sid1, level: "info", message: "loaded" });
    logConsoleMessage({ session_id: sid1, level: "warn", message: "deprecated" });
    logConsoleMessage({ session_id: sid1, level: "error", message: "boom" });

    const errors = getConsoleLog(sid1, "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("boom");

    const warns = getConsoleLog(sid1, "warn");
    expect(warns).toHaveLength(1);
  });

  it("returns messages in chronological order", () => {
    logConsoleMessage({ session_id: sid1, level: "info", message: "first" });
    logConsoleMessage({ session_id: sid1, level: "info", message: "second" });
    const all = getConsoleLog(sid1);
    expect(all.map(m => m.message)).toEqual(["first", "second"]);
  });

  it("scopes to the session when no level filter is given", () => {
    logConsoleMessage({ session_id: sid1, level: "info", message: "mine" });
    logConsoleMessage({ session_id: sid2, level: "info", message: "other" });
    expect(getConsoleLog(sid1)).toHaveLength(1);
  });

  it("clears the log for one session", () => {
    logConsoleMessage({ session_id: sid1, level: "info", message: "a" });
    logConsoleMessage({ session_id: sid2, level: "info", message: "b" });
    clearConsoleLog(sid1);
    expect(getConsoleLog(sid1)).toHaveLength(0);
    expect(getConsoleLog(sid2)).toHaveLength(1);
  });

  it("persists the message with sanitization applied", () => {
    // The message goes through sanitizeBrowserDbRow -> redactSensitiveText;
    // a header-looking secret-shaped string must not be stored verbatim.
    const msg = logConsoleMessage({
      session_id: sid1,
      level: "log",
      message: "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    });
    const stored = getConsoleMessage(msg.id);
    expect(stored?.message).not.toContain("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });
});
