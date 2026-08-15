/**
 * Regression tests for P1-3 event-log redaction.
 *
 * A tool_input / error / metadata carrying a credential must never be stored
 * verbatim, and must never be returned by a log read path — whether written
 * now (write-time projection) or written by an older version (read-time
 * truncate-on-read projection).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runHook } from "../index.js";
import { getDb, closeDb } from "../db/index.js";
import { recordHookRun } from "./db-writer.js";
import { redactEventPayload, projectEventRowForRead, redactText, redactValue } from "./redact.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-redact-test-"));

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

function customHook(name: string, script: string): string {
  const dir = join(TEST_DIR, "hooks", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    name,
    version: "1.0.0",
    events: ["PreToolUse"],
    script: "script.ts",
  }));
  const scriptPath = join(dir, "script.ts");
  writeFileSync(scriptPath, script);
  return scriptPath;
}

describe("redactEventPayload primitives", () => {
  test("redacts secret-typed JSON keys", () => {
    const input = JSON.stringify({ command: "echo hi", api_key: "sk-live-abcdefghijklmnop", token: "ghp_live", nested: { password: "pw" } });
    const out = redactEventPayload(input)!;
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sk-live");
    expect(out).not.toContain("ghp_live");
    expect(out).not.toContain('"pw"');
    const parsed = JSON.parse(out);
    expect(parsed.api_key).toBe("[REDACTED]");
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.nested.password).toBe("[REDACTED]");
    expect(parsed.command).toBe("echo hi");
  });

  test("redacts inline credential shapes in plain text", () => {
    expect(redactText("curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'")).toContain("[REDACTED]");
    expect(redactText("export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz")).toContain("[REDACTED]");
    expect(redactText("export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE")).toContain("[REDACTED]");
    expect(redactText("sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")).toContain("[REDACTED]");
    expect(redactText("plain error message: command not found")).toBe("plain error message: command not found");
    expect(redactText("keyboard")).toBe("keyboard");
  });

  test("redactValue walks nested structures", () => {
    const out = redactValue({ a: { b: [{ c: "sk-abcdefghijklmnopqrstuvwxyz123456" }], refresh_token: "x" } });
    expect(JSON.stringify(out)).not.toContain("sk-abcdefghijklmnop");
    expect((out as any).a.refresh_token).toBe("[REDACTED]");
  });

  test("projectEventRowForRead redacts the three fields and leaves the rest", () => {
    const row = {
      id: "e1",
      tool_name: "Bash",
      tool_input: JSON.stringify({ token: "ghp_readpath" }),
      error: "boom: sk-abcdefghijklmnopqrstuvwxyz123456",
      metadata: JSON.stringify({ sha256: "abc", secret: "s3cret" }),
      result: "continue",
      hook_name: "gitguard",
    };
    const out = projectEventRowForRead(row);
    expect(out.tool_input).not.toContain("ghp_readpath");
    expect(out.error).not.toContain("sk-abcdefghijklmnop");
    expect(out.metadata).not.toContain("s3cret");
    expect(out.hook_name).toBe("gitguard");
    expect(out.result).toBe("continue");
    expect(out.tool_name).toBe("Bash");
  });
});

describe("write-time projection (P1-3)", () => {
  test("recordHookRun stores a redacted tool_input, never verbatim", () => {
    recordHookRun({
      hookName: "redact-demo",
      eventType: "PreToolUse",
      toolName: "Bash",
      toolInput: { command: "echo", token: "ghp_write_time_secret_12345678901234567890" },
      result: "continue",
      exitCode: 0,
      durationMs: 5,
    });
    const rows = getDb().query("SELECT tool_input FROM hook_events WHERE hook_name = 'redact-demo'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tool_input).not.toContain("ghp_write_time_secret");
    expect(rows[0].tool_input).toContain("[REDACTED]");
  });

  test("a real runHook with a secret-shaped tool_input lands redacted", async () => {
    const { checkScriptHash, sha256Of } = await import("./store.js");
    const scriptPath = customHook("redact-run", `console.log(JSON.stringify({ continue: true }));\n`);
    const content = require("fs").readFileSync(scriptPath);
    checkScriptHash("redact-run", sha256Of(content));

    await runHook("redact-run", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "curl https://api.example.com", api_key: "sk-run_secret_abcdefghijklmnopqrstuvwxyz123456" },
      session_id: "s-redact",
    });
    const rows = getDb().query("SELECT tool_input, metadata FROM hook_events WHERE hook_name = 'redact-run'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tool_input).not.toContain("sk-run_secret");
    expect(rows[0].tool_input).toContain("[REDACTED]");
  });
});

describe("read-time projection (P1-3)", () => {
  test("rows written verbatim by an older version are redacted on read", () => {
    const db = getDb();
    db.run(
      `INSERT INTO hook_events (id, timestamp, session_id, hook_name, event_type, tool_input, error, metadata)
       VALUES ('legacy-secret', ?, 's', 'gitguard', 'PreToolUse', ?, ?, ?)`,
      [
        new Date().toISOString(),
        JSON.stringify({ command: "curl", password: "legacy-pw-value" }),
        "error: token=ghp_legacy_secret_123456789012345678901234",
        JSON.stringify({ secret: "legacy-metadata-secret" }),
      ],
    );
    const rows = db.query("SELECT * FROM hook_events WHERE id = 'legacy-secret'").all() as any[];
    const projected = projectEventRowForRead(rows[0]);
    expect(projected.tool_input).not.toContain("legacy-pw-value");
    expect(projected.error).not.toContain("ghp_legacy_secret");
    expect(projected.metadata).not.toContain("legacy-metadata-secret");
  });
});
