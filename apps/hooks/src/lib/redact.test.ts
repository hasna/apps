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

/**
 * Sentinel builders — the CI secrets gate scans ADDED LINES for real token
 * shapes, so fixtures build the shape at runtime by concatenation: the source
 * never contains the literal (the project/Anthropic key prefixes, the GitHub
 * token prefix, the AWS key prefix), while
 * the redactor still sees the real shape under test (P2-6 fixture policy).
 */
const sentinel = {
  skProj: (body: string) => `sk-${"proj"}-${body}`,
  skAnt: (body: string) => `sk-${"ant-api03"}-${body}`,
  ghp: (body: string) => `gh${"p_"}${body}`,
  gho: (body: string) => `gh${"o_"}${body}`,
  aws: (body: string) => `AKIA${body}`,
};

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
    const input = JSON.stringify({ command: "echo hi", api_key: "sk-live-abcdefghijklmnop", token: sentinel.ghp("live"), nested: { password: "pw" } });
    const out = redactEventPayload(input)!;
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sk-live");
    expect(out).not.toContain(sentinel.ghp("live"));
    expect(out).not.toContain('"pw"');
    const parsed = JSON.parse(out);
    expect(parsed.api_key).toBe("[REDACTED]");
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.nested.password).toBe("[REDACTED]");
    expect(parsed.command).toBe("echo hi");
  });

  test("redacts inline credential shapes in plain text", () => {
    expect(redactText("curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'")).toContain("[REDACTED]");
    expect(redactText(`export GITHUB_TOKEN=${sentinel.ghp("abcdefghijklmnopqrstuvwxyz")}`)).toContain("[REDACTED]");
    expect(redactText(`export AWS_ACCESS_KEY_ID=${sentinel.aws("IOSFODNN7EXAMPLE")}`)).toContain("[REDACTED]");
    expect(redactText(sentinel.skAnt("abcdefghijklmnopqrstuvwxyz1234567890-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"))).toContain("[REDACTED]");
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
      tool_input: JSON.stringify({ token: sentinel.ghp("readpath0123456789abcdef") }),
      error: "boom: sk-abcdefghijklmnopqrstuvwxyz123456",
      metadata: JSON.stringify({ sha256: "abc", secret: "s3cret" }),
      result: "continue",
      hook_name: "gitguard",
    };
    const out = projectEventRowForRead(row);
    expect(out.tool_input).not.toContain("readpath0123456789abcdef");
    expect(out.error).not.toContain("sk-abcdefghijklmnop");
    expect(out.metadata).not.toContain("s3cret");
    expect(out.hook_name).toBe("gitguard");
    expect(out.result).toBe("continue");
    expect(out.tool_name).toBe("Bash");
  });
});

describe("round-2A probed shapes (P1-1)", () => {
  test("Authorization: Bearer <OpenAI project-format token> redacts the token as a unit, never just the word Bearer", () => {
    const token = sentinel.skProj("0123456789abcdef0123456789abcdef");
    const out = redactText(`curl -H "Authorization: Bearer ${token}"`);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain(token);
    expect(out).not.toContain("sk-");
  });

  test("Authorization: Bearer <unrecognized token> redacts the whole Bearer unit", () => {
    const out = redactText("Authorization: Bearer abcdef1234567890qwerty");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("abcdef1234567890qwerty");
  });

  test("bare OpenAI project/service and Anthropic key forms are redacted whole", () => {
    const proj = sentinel.skProj("0123456789abcdef0123456789abcdef");
    const ant = sentinel.skAnt("0123456789abcdef0123456789abcdef-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop");
    const outProj = redactText(proj);
    const outAnt = redactText(`key=${ant}`);
    expect(outProj).toContain("[REDACTED]");
    expect(outProj).not.toContain("0123456789abcdef");
    expect(outAnt).toContain("[REDACTED]");
    expect(outAnt).not.toContain("0123456789abcdef");
  });

  test("Stripe tpe_ / rk_live_ / sk_live_ keys are redacted", () => {
    // Stripe key shapes are built by concatenation too — GitHub push
    // protection flags the literal live-key form in committed bytes.
    const stripe = (kind: string, body: string) => `${kind}_${"live"}_${body}`;
    expect(redactText("pk=tpe_1A2B3C4D5E6F7G8H9I0J")).toContain("[REDACTED]");
    expect(redactText(stripe("rk", "51Hx9yZ0aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"))).toContain("[REDACTED]");
    expect(redactText(stripe("sk", "51Hx9yZ0aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"))).toContain("[REDACTED]");
    expect(redactText(stripe("sk", "51Hx9yZ0aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"))).not.toContain("51Hx9yZ0");
  });

  test("fine-grained GitHub PATs are redacted", () => {
    const pat = `github_pat_${"a".repeat(30)}_${"B".repeat(30)}`;
    const out = redactText(pat);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("github_pat_");
  });

  test("URL-embedded credentials are redacted through the @; the host survives", () => {
    const out = redactText("postgres://user:realpass@host:5432/db");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("realpass");
    expect(out).not.toContain("user:");
    expect(out).toContain("host:5432/db");
  });

  test("spaced, quoted and multiline values are redacted", () => {
    expect(redactText('PASSWORD = "spaced pass phrase"')).not.toContain("spaced");
    expect(redactText("password = supersecretvalue")).toContain("[REDACTED]");
    expect(redactText("token=\nsupersecretvalue")).toContain("[REDACTED]");
    expect(redactText("token : supersecretvalue")).toContain("[REDACTED]");
    expect(redactText("DATABASE_URL=postgres://user:realpass@host/db")).not.toContain("realpass");
  });

  test("JSON database_url values are redacted by key name", () => {
    const input = JSON.stringify({ command: "psql", database_url: "postgres://user:realpass@host/db" });
    const out = redactEventPayload(input)!;
    expect(out).not.toContain("realpass");
    const parsed = JSON.parse(out);
    expect(parsed.database_url).toBe("[REDACTED]");
    expect(parsed.command).toBe("psql");
  });

  test("no surviving key fragments across every probed shape", () => {
    const token = sentinel.skProj("0123456789abcdef0123456789abcdef");
    const inputs = [
      `Authorization: Bearer ${token}`,
      token,
      `postgres://alice:supersecretpassword@db.internal:5432/app`,
      "token = supersecretvalue",
      `x-api-key: ${sentinel.ghp("abcdefghijklmnopqrstuvwxyz")}`,
      "curl -H \"Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U\"",
    ];
    for (const input of inputs) {
      const out = redactText(input);
      expect(out).toContain("[REDACTED]");
      // No fragment of any secret may survive: assert each distinctive
      // fragment is absent from the redacted output.
      expect(out).not.toContain("0123456789abcdef");
      expect(out).not.toContain("supersecretpassword");
      expect(out).not.toContain("supersecretvalue");
      expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz");
      expect(out).not.toContain("dozjgNryP4J3jVm");
    }
  });
});

describe("write-time projection (P1-3)", () => {
  test("recordHookRun stores a redacted tool_input, never verbatim", () => {
    recordHookRun({
      hookName: "redact-demo",
      eventType: "PreToolUse",
      toolName: "Bash",
      toolInput: { command: "echo", token: sentinel.ghp("write_time_secret_12345678901234567890") },
      result: "continue",
      exitCode: 0,
      durationMs: 5,
    });
    const rows = getDb().query("SELECT tool_input FROM hook_events WHERE hook_name = 'redact-demo'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tool_input).not.toContain("write_time_secret_12345678901234567890");
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
      tool_input: { command: "curl https://api.example.com", api_key: sentinel.skProj("run_secret_0123456789abcdef0123456789") },
      session_id: "s-redact",
    });
    const rows = getDb().query("SELECT tool_input, metadata FROM hook_events WHERE hook_name = 'redact-run'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tool_input).not.toContain("run_secret_0123456789abcdef0123456789");
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
        `error: token=${sentinel.ghp("legacy_secret_123456789012345678901234")}`,
        JSON.stringify({ secret: "legacy-metadata-secret" }),
      ],
    );
    const rows = db.query("SELECT * FROM hook_events WHERE id = 'legacy-secret'").all() as any[];
    const projected = projectEventRowForRead(rows[0]);
    expect(projected.tool_input).not.toContain("legacy-pw-value");
    expect(projected.error).not.toContain("legacy_secret_123456789012345678901234");
    expect(projected.metadata).not.toContain("legacy-metadata-secret");
  });
});
