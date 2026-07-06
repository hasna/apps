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

    // appId inference is aligned with hasna.app.v1: @hasna/changelog -> open-changelog
    const inferred = runCli(["add", "Inferred app entry", "--kind", "added"], env);
    expect(inferred).toContain("\"appId\": \"open-changelog\"");
    expect(runCli(["release", "--version", "1.0.0", "--date", "2026-07-01"], env)).toContain("\"updated\": 1");
    expect(runCli(["generate", "--version", "1.0.0"], env)).toContain("Inferred app entry");
    expect(runCli(["publish", "--version", "1.0.0", "--diff"], env)).toContain("+++ generated");
  });

  test("publish --release promotes appId+version and returns a changelogRef", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "open-changelog-cli-release-"));
    const workDir = await mkdtemp(join(tmpdir(), "open-changelog-cli-release-target-"));
    const env = { CHANGELOG_DATA_DIR: dataDir };

    runCli(["add", "Release entrypoint change", "--app", "@hasna/todos", "--kind", "added"], env);
    const target = join(workDir, "CHANGELOG.md");
    const output = runCli([
      "publish", "--release",
      "--app", "@hasna/todos",
      "--version", "1.2.3",
      "--date", "2026-07-06",
      "--target", target,
      "--base-url", "https://changelog.hasna.com",
    ], env);
    const result = JSON.parse(output) as {
      appId: string;
      released: { updated: number };
      publish: { mode: string; targetPath: string };
      changelogRef: { kind: string; id: string; uri: string };
    };
    expect(result.appId).toBe("open-todos");
    expect(result.released.updated).toBe(1);
    expect(result.publish.mode).toBe("write");
    expect(result.changelogRef).toMatchObject({
      kind: "document",
      id: "changelog:open-todos@1.2.3",
      uri: "https://changelog.hasna.com/apps/open-todos/",
    });
  });

  test("web generates a static site with feeds", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "open-changelog-cli-web-"));
    const outDir = await mkdtemp(join(tmpdir(), "open-changelog-cli-web-out-"));
    const env = { CHANGELOG_DATA_DIR: dataDir };

    runCli(["add", "Web page entry", "--app", "open-todos", "--version", "1.0.0", "--kind", "added"], env);
    const output = runCli(["web", "--out", outDir, "--base-url", "https://changelog.hasna.com"], env);
    const result = JSON.parse(output) as { apps: Array<{ appId: string; rssPath: string; jsonFeedPath: string }>; files: string[] };
    expect(result.apps.map((app) => app.appId)).toEqual(["open-todos"]);
    expect(result.files).toContain("apps/open-todos/rss.xml");
    expect(result.files).toContain("apps/open-todos/feed.json");
    expect(result.files).toContain("index.html");
  });
});
