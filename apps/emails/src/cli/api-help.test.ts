import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
async function run(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "emails-api-help-")); homes.push(home);
  const child = Bun.spawn({ cmd: [process.execPath, "src/cli/index.tsx", ...args],
    env: { HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_STATION: `emails-help-${randomUUID()}`, PATH: "/usr/bin:/bin", NO_COLOR: "1", AWS_EC2_METADATA_DISABLED: "true" }, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(readdirSync(home, { recursive: true }).some((name) => /\.(db|sqlite)(-wal|-shm)?$/.test(String(name)))).toBe(false);
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}
for (const args of [["--help"], ["inbox", "--help"], ["email", "--help"], ["stats", "--help"], ["daemon", "--help"], ["schedule", "--help"], ["provider", "--help"], ["send", "--help"], ["domain", "--help"]]) {
  test(`fresh client displays ${args.join(" ")} without credentials`, async () => {
    const result = await run(args);
    expect(result.stderr).toBe(""); expect(result.code).toBe(0); expect(result.stdout).toContain("Usage:");
  }, 20000);
}
for (const args of [["stats", "--json"], ["inbox", "list", "--json"], ["send", "--from", "sender@example.test", "--to", "recipient@example.test", "--subject", "fixture", "--body", "fixture", "--json"]]) {
  test(`mail action ${args.join(" ")} still requires API credentials`, async () => {
    const result = await run(args);
    expect(result.code).not.toBe(0); expect(result.stdout + result.stderr).toContain("No Emails API credential resolved");
  }, 20000);
}
