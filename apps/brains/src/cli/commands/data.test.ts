import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { getMergeOutputDirectory } from "./data.js";

async function runBrainsCli(args: string[], homeDir: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cliPath = resolve(import.meta.dir, "../index.ts");
  const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, HOME: homeDir },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function writeNoisyJsonl(): { dir: string; homeDir: string; file: string; longText: string } {
  const dir = mkdtempSync(join(tmpdir(), "brains-preview-"));
  const homeDir = join(dir, "home");
  const file = join(dir, "examples.jsonl");
  const longText = "x".repeat(500);
  writeFileSync(
    file,
    JSON.stringify({
      messages: [
        { role: "system", content: "Use this training style." },
        { role: "user", content: `Explain the CLI output problem ${longText}` },
        { role: "assistant", content: `Here is a long answer ${longText}` },
      ],
      metadata: { source: "sessions", path: `/tmp/${longText}` },
    }) + "\n",
    "utf8"
  );
  return { dir, homeDir, file, longText };
}

describe("data merge output directory", () => {
  test("returns parent directory for explicit output path", () => {
    expect(getMergeOutputDirectory("/tmp/brains/out/merged.jsonl")).toBe("/tmp/brains/out");
  });

  test("falls back to dataset directory when output path is empty", () => {
    expect(getMergeOutputDirectory(""))
      .toContain(".hasna/brains/datasets");
  });
});

describe("data preview output disclosure", () => {
  test("default preview is compact and hints at verbose output", async () => {
    const fixture = writeNoisyJsonl();
    try {
      const result = await runBrainsCli(["data", "preview", fixture.file, "--count", "1"], fixture.homeDir);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Showing first 1 compact preview");
      expect(result.stdout).toContain("Use --verbose for full example JSON");
      expect(result.stdout).not.toContain(fixture.longText);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  test("verbose preview shows full example JSON", async () => {
    const fixture = writeNoisyJsonl();
    try {
      const result = await runBrainsCli(["data", "preview", fixture.file, "--count", "1", "--verbose"], fixture.homeDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("\"messages\"");
      expect(result.stdout).toContain(fixture.longText);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  test("json preview remains machine-readable with full examples", async () => {
    const fixture = writeNoisyJsonl();
    try {
      const result = await runBrainsCli(["data", "preview", fixture.file, "--count", "1", "--json"], fixture.homeDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { total: number; shown: number; examples: Array<{ messages: Array<{ content: string }> }> };
      expect(parsed.total).toBe(1);
      expect(parsed.shown).toBe(1);
      expect(parsed.examples[0]?.messages[1]?.content).toContain(fixture.longText);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });
});
