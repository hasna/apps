/**
 * Regression: every hook execution lands in hook_events so `hooks log` shows
 * rows after a real fire (QA-5/QA-2, bug ef58dcb7: 0 rows after real fires).
 * The row carries name, version, sha, event, exit and ts (version+sha in the
 * metadata JSON — the schema's dedicated columns).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runHook } from "../index.js";
import { getDb, closeDb } from "../db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-eventlog-test-"));

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function customHook(name: string, version: string, script: string): string {
  const dir = join(TEST_DIR, "hooks", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    name,
    version,
    events: ["PreToolUse"],
    script: "script.ts",
  }));
  const scriptPath = join(dir, "script.ts");
  writeFileSync(scriptPath, script);
  return scriptPath;
}

describe("hook run event logging (bug ef58dcb7)", () => {
  test("SDK runHook writes a hook_events row with name, event, result, exit and metadata (version+sha)", async () => {
    const { checkScriptHash, sha256Of } = await import("./store.js");
    const scriptPath = customHook("log-demo", "3.2.1", `const input = JSON.parse(await Bun.stdin.text());\nconsole.log(JSON.stringify({ continue: true, saw: input.tool_name }));\n`);
    // Trust the hook first so the run path is the one under test.
    const content = require("fs").readFileSync(scriptPath);
    checkScriptHash("log-demo", sha256Of(content));

    const res = await runHook("log-demo", { hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "sess-abc" });
    expect(res.exitCode).toBe(0);

    const rows = getDb().query("SELECT * FROM hook_events ORDER BY timestamp DESC").all() as any[];
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.hook_name).toBe("log-demo");
    expect(row.event_type).toBe("PreToolUse");
    expect(row.tool_name).toBe("Bash");
    expect(row.session_id).toBe("sess-abc");
    expect(row.result).toBe("continue");
    expect(row.error).toBeNull();
    const metadata = JSON.parse(row.metadata);
    expect(metadata.version).toBe("3.2.1");
    expect(metadata.sha256).toBe(sha256Of(content));
    expect(metadata.exit_code).toBe(0);
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
    expect(row.timestamp).toBeTruthy();
  });

  test("a blocking hook records result=block", async () => {
    const { checkScriptHash, sha256Of } = await import("./store.js");
    const scriptPath = customHook("block-demo", "1.0.0", `console.log(JSON.stringify({ decision: "block", reason: "no" }));\n`);
    const content = require("fs").readFileSync(scriptPath);
    checkScriptHash("block-demo", sha256Of(content));

    const res = await runHook("block-demo", { hook_event_name: "PreToolUse", tool_name: "Bash" });
    expect(res.output.decision).toBe("block");
    const rows = getDb().query("SELECT * FROM hook_events WHERE hook_name = 'block-demo'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBe("block");
  });

  test("a failing hook records an error row with its exit code", async () => {
    const { checkScriptHash, sha256Of } = await import("./store.js");
    const scriptPath = customHook("fail-demo", "1.0.0", `console.error("boom");\nprocess.exit(3);\n`);
    const content = require("fs").readFileSync(scriptPath);
    checkScriptHash("fail-demo", sha256Of(content));

    const res = await runHook("fail-demo", { hook_event_name: "PostToolUse" });
    expect(res.exitCode).toBe(3);
    const rows = getDb().query("SELECT * FROM hook_events WHERE hook_name = 'fail-demo'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toContain("boom");
    expect(JSON.parse(rows[0].metadata).exit_code).toBe(3);
  });

  test("an unknown event name from hook input does not crash the write", async () => {
    const { checkScriptHash, sha256Of } = await import("./store.js");
    const scriptPath = customHook("weird-event-demo", "1.0.0", `console.log("{}");\n`);
    const content = require("fs").readFileSync(scriptPath);
    checkScriptHash("weird-event-demo", sha256Of(content));

    const res = await runHook("weird-event-demo", { hook_event_name: "TotallyMadeUp", tool_name: "Bash" });
    expect(res.exitCode).toBe(0);
    // Falls back to the manifest's declared event (PreToolUse), so a row
    // still lands.
    const rows = getDb().query("SELECT * FROM hook_events WHERE hook_name = 'weird-event-demo'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe("PreToolUse");
  });
});
