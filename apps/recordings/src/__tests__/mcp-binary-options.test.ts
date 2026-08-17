import { describe, expect, test } from "bun:test";
import { join } from "path";
import { VERSION } from "../version.js";

// The `recordings-mcp` binary (`bin` entry -> dist/mcp/index.js, bundled from
// src/mcp/index.ts) must answer --version / -V and --help / -h WITHOUT binding
// an HTTP port. Before this suite existed, main() only handled --stdio and
// otherwise called startMcpHttpServer() unconditionally, so on a fleet station
// whose MCP port band (8870-8878) is occupied by a running instance the binary
// died with EADDRINUSE rc=1 on `--version` (measured on the installed 0.2.14),
// and on a free port it bound-and-hung instead of printing a version. Sibling
// MCPs (repos-mcp, prompts-mcp, sessions-mcp) answer --version correctly.
//
// The entry is spawned as source (process.execPath + src/mcp/index.ts), the
// same convention as trigger-diagnosis.test.ts; build:mcp bundles this exact
// entry into dist/mcp/index.js. Each spawn is bounded so that a regression to
// bind-before-arg-handling fails the suite with a clear timeout instead of
// hanging it.

const repoRoot = join(import.meta.dir, "..", "..");
const mcpEntry = join("src", "mcp", "index.ts");

const BOUND_MS = 15_000;

async function runMcp(args: string[]): Promise<{
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn([process.execPath, mcpEntry, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const collect = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<string> => {
    let out = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
    } catch {
      // Stream torn down when the bounded wait kills the child; the captured
      // prefix is still the evidence we need.
    }
    return out;
  };
  const stdoutPromise = collect(proc.stdout.getReader());
  const stderrPromise = collect(proc.stderr.getReader());

  const exited = proc.exited.then(
    (code): { exitCode: number | null; timedOut: boolean } => ({
      exitCode: code,
      timedOut: false,
    }),
  );
  const timer = new Promise<{ exitCode: number | null; timedOut: boolean }>(
    (resolve) => setTimeout(() => resolve({ exitCode: null, timedOut: true }), BOUND_MS),
  );
  const outcome = await Promise.race([exited, timer]);
  if (outcome.timedOut) {
    proc.kill();
    await proc.exited.catch(() => {});
  }
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { ...outcome, stdout, stderr };
}

describe("recordings-mcp argument handling", () => {
  test("--version prints the package version and exits without binding a port", async () => {
    const result = await runMcp(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
    // A process that bound the HTTP port would still be running (the
    // station03 hang shape) or would have died EADDRINUSE (the fleet shape) —
    // either way it would not have exited 0 having printed only the version.
    expect(result.stderr).not.toContain("HTTP listening");
  });

  test("-V prints the package version and exits without binding a port", async () => {
    const result = await runMcp(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
    expect(result.stderr).not.toContain("HTTP listening");
  });

  test("--help prints usage and exits without binding a port", async () => {
    const result = await runMcp(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage");
    expect(result.stdout).toContain("--stdio");
    expect(result.stdout).toContain("--port");
    expect(result.stderr).not.toContain("HTTP listening");
  });

  test("-h prints usage and exits without binding a port", async () => {
    const result = await runMcp(["-h"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage");
    expect(result.stderr).not.toContain("HTTP listening");
  });
});
