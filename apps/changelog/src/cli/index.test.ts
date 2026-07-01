import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function runCli(args: string[], env: Record<string, string> = {}): string {
  const proc = Bun.spawnSync(["bun", "src/cli/index.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`CLI failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString();
}

describe("changelog CLI", () => {
  test("supports required smoke flow from source", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "open-changelog-cli-"));
    const env = { CHANGELOG_DATA_DIR: dataDir };

    const help = runCli(["--help"], env);
    expect(help).toContain("add [options] <title>");
    expect(help).toContain("update [options] <id>");
    expect(help).toContain("export [options]");
    expect(runCli(["generate", "--help"], env)).toContain("--kind <kind>");
    expect(runCli(["publish", "--help"], env)).toContain("--title <title>");
    expect(help).not.toContain("--token");

    expect(runCli(["init"], env)).toContain("entries.jsonl");
    expect(runCli(["add", "Initial changelog scaffold", "--app", "open-changelog", "--version", "0.1.0", "--kind", "added"], env))
      .toContain("\"version\": \"0.1.0\"");
    runCli(["add", "Fixed changelog bug", "--app", "open-changelog", "--version", "0.1.0", "--kind", "fixed"], env);
    const markdown = runCli(["generate", "--app", "open-changelog", "--version", "0.1.0", "--kind", "added"], env);
    expect(markdown).toContain("## [0.1.0]");
    expect(markdown).toContain("Initial changelog scaffold");
    expect(markdown).not.toContain("Fixed changelog bug");

    const inferred = runCli(["add", "Inferred app entry", "--kind", "added"], env);
    expect(inferred).toContain("\"appId\": \"changelog\"");
    expect(runCli(["release", "--version", "1.0.0", "--date", "2026-07-01"], env)).toContain("\"updated\": 1");
    expect(runCli(["generate", "--version", "1.0.0"], env)).toContain("Inferred app entry");
    expect(runCli(["publish", "--version", "1.0.0", "--diff"], env)).toContain("+++ generated");
  });
});
