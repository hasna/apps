import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { routerVersion } from "../src/version";

function run(argv: string[]): Promise<{ output: string; exitCode: number }> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  process.exitCode = 0;
  return runCli(argv)
    .then(() => ({ output: lines.join("\n"), exitCode: Number(process.exitCode ?? 0) }))
    .finally(() => {
      console.log = originalLog;
      process.exitCode = originalExitCode;
    });
}

describe("cli top-level flags", () => {
  test("--version prints the version and exits 0", async () => {
    const { output, exitCode } = await run(["--version"]);
    expect(output).toBe(routerVersion);
    expect(exitCode).toBe(0);
  });

  test("version command prints the version and exits 0", async () => {
    const { output, exitCode } = await run(["version"]);
    expect(output).toBe(routerVersion);
    expect(exitCode).toBe(0);
  });

  test("--help prints help and exits 0", async () => {
    const { output, exitCode } = await run(["--help"]);
    expect(output).toContain("Usage:");
    expect(exitCode).toBe(0);
  });

  test("help command prints help and exits 0", async () => {
    const { output, exitCode } = await run(["help"]);
    expect(output).toContain("Usage:");
    expect(exitCode).toBe(0);
  });
});
