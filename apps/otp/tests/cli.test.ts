import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBase32Secret } from "./helpers.js";

const CLI = join(import.meta.dir, "..", "src", "cli", "index.ts");

let home: string;

async function runCli(args: string[], stdin?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", CLI, ...args],
    stdin: stdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HASNA_OTP_HOME: home,
    },
  });
  if (stdin && proc.stdin) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "open-otp-cli-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("otp CLI", () => {
  test("adds, lists, generates, and removes without echoing the seed", async () => {
    const secret = randomBase32Secret();
    const add = await runCli(["add", "--issuer", "Example", "--account", "agent@example.com", "--label", "example-agent", "--secret-stdin", "--json"], secret);
    expect(add.exitCode).toBe(0);
    expect(add.stdout).not.toContain(secret);
    expect(add.stderr).toBe("");

    const list = await runCli(["list", "--json"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("example-agent");
    expect(list.stdout).not.toContain(secret);

    const generated = await runCli(["generate", "example-agent", "--at", "59"]);
    expect(generated.exitCode).toBe(0);
    expect(generated.stdout.trim()).toMatch(/^\d{6}$/);
    expect(generated.stdout).not.toContain(secret);

    const removed = await runCli(["remove", "example-agent", "--json"]);
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toContain("example-agent");
    expect(removed.stdout).not.toContain(secret);
  });
});
