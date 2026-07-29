import { describe, expect, test } from "bun:test";
import { gatewayVersion } from "../src/version";

function runGateway(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf-8");
}

describe("gateway CLI help", () => {
  test("supports standard top-level help and version flags", () => {
    const help = runGateway(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(text(help.stdout)).toContain("gateway budget-add");
    expect(text(help.stdout)).toContain("--max-input-tokens");
    expect(text(help.stderr)).toBe("");

    const version = runGateway(["--version"]);
    expect(version.exitCode).toBe(0);
    expect(text(version.stdout).trim()).toBe(gatewayVersion);
    expect(text(version.stderr)).toBe("");
  });
});
