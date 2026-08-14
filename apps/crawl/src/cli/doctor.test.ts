import { describe, expect, it } from "bun:test";
import { join } from "path";

const repoRoot = join(import.meta.dir, "../..");

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return await new Response(stream).text();
}

async function runCli(args: string[], envOverrides: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
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

describe("crawl doctor", () => {
  it("reports Exa web search status without exposing the key", async () => {
    const result = await runCli(["doctor", "--json"], {
      EXA_API_KEY: "secret-value",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("secret-value");
    const report = JSON.parse(result.stdout) as {
      providers: { webSearch: { exa: { available: boolean; env: string } } };
    };
    expect(report.providers.webSearch.exa).toMatchObject({
      available: true,
      env: "EXA_API_KEY",
    });
  });
});
