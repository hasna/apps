import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRedactionCli } from "./redaction-cli.js";

const scratch = mkdtempSync(join(tmpdir(), "mementos-cli-diagnostics-"));
const cli = join(scratch, "child.ts");
mkdirSync(join(scratch, "home"));
mkdirSync(join(scratch, "bin"));
// npm's Bun package can expose process.execPath as bun.exe on macOS. Supply
// the same executable under the command name used by the existing harness.
symlinkSync(process.execPath, join(scratch, "bin", "bun"));
writeFileSync(cli, `
const mode = process.argv[2];
const token = "npm" + "_" + "a".repeat(36);
const aws = "AK" + "IAIOSFODNN7EXAMPLE";
if (mode === "success") { console.log("  original output  "); process.exit(0); }
if (mode === "fuzzy") { console.log("expected fuzzy receipt"); process.exit(2); }
console.log("raw stdout canary " + token);
if (mode === "large") console.error("x".repeat(3990) + token + " " + "y".repeat(5000));
else console.error("SQLiteError: database is locked; " + token + " " + aws + " API_KEY=unusual-secret-fixture-value");
process.exit(1);
`);
const env = {
  PATH: `${join(scratch, "bin")}:/usr/bin:/bin`,
  HOME: join(scratch, "home"),
  TMPDIR: scratch,
  DIAGNOSTIC_ENV_CANARY: "must-not-log-environment-values",
};
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function failure(mode: string): Promise<string> {
  try {
    await runRedactionCli(cli, env, [mode, "must-not-log-argv"]);
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error("Expected the real child to fail");
}

describe("redaction CLI subprocess diagnostics", () => {
  test("preserves successful output and explicitly expected fuzzy exit status", async () => {
    expect(await runRedactionCli(cli, env, ["success"])).toMatchObject({ stdout: "original output", stderr: "", exitCode: 0 });
    expect(await runRedactionCli(cli, env, ["fuzzy"], 2)).toMatchObject({ stdout: "expected fuzzy receipt", exitCode: 2 });
    expect(await failure("fuzzy")).toContain('"exitCode":2');
  });

  test("unexpected real child exit reports useful stderr without credential canaries or process inputs", async () => {
    const message = await failure("failure");
    expect(message).toContain("SQLiteError: database is locked");
    expect(message).toContain('"exitCode":1');
    expect(message).toContain('"expectedExitCode":0');
    expect(message).toContain('"signalCode":null');
    expect(message).toContain("[REDACTED]");
    for (const canary of ["npm" + "_" + "a".repeat(36), "AK" + "IAIOSFODNN7EXAMPLE", "unusual-secret-fixture-value", "raw stdout canary", env.DIAGNOSTIC_ENV_CANARY, "must-not-log-argv"]) {
      expect(message).not.toContain(canary);
    }
    const details = JSON.parse(message.slice(message.indexOf("{")!));
    expect(details.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(details.stdoutBytes).toBeGreaterThan(0);
    expect(details.stderrTruncated).toBe(false);
  });

  test("redacts whole stderr before bounding the diagnostic, including a token across the cut", async () => {
    const message = await failure("large");
    const details = JSON.parse(message.slice(message.indexOf("{")!));
    expect(details.stderr.length).toBe(4000);
    expect(details.stderrTruncated).toBe(true);
    expect(details.stderr).toContain("[REDACTED]");
    expect(details.stderr).not.toContain("npm" + "_");
    expect(message.length).toBeLessThan(4300);
  });
});
