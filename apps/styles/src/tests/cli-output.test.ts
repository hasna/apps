import { describe, expect, test } from "bun:test";
import { join } from "path";

const repoRoot = join(import.meta.dir, "../..");

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runCli(args: string[]) {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

describe("compact CLI output", () => {
  test("styles list is compact by default under non-TTY", async () => {
    const result = await runCli(["list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Styles (10)");
    expect(result.stdout).toContain("Name");
    expect(result.stdout).toContain("use `styles info <name>`");
    expect(result.stdout.length).toBeLessThan(2500);
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  test("styles list preserves full JSON when requested", async () => {
    const result = await runCli(["list", "--json"]);
    const styles = JSON.parse(result.stdout) as Array<{ name: string; principles: string[] }>;

    expect(result.exitCode).toBe(0);
    expect(styles).toHaveLength(10);
    expect(styles[0].name).toBe("minimalist");
    expect(Array.isArray(styles[0].principles)).toBe(true);
  });
});
