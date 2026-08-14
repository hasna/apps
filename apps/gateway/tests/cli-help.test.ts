import { readFileSync } from "node:fs";
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
  test("keeps the registered command inventory explicit", () => {
    const source = readFileSync(new URL("../src/cli/index.ts", import.meta.url), "utf8");
    const registered = [...source.matchAll(/parsed\.command === "([^"]+)"/g)]
      .map((match) => match[1])
      .filter((command): command is string => Boolean(command));

    expect([...new Set(registered)].sort()).toEqual([
      "--help",
      "--version",
      "budget-add",
      "budget-list",
      "budget-remaining",
      "budget-reset",
      "help",
      "remove",
      "route",
      "routes",
      "serve",
      "smoke",
      "uninstall",
      "validate",
    ]);
  });

  test("supports standard top-level help and version flags", () => {
    for (const args of [[], ["help"], ["--help"]]) {
      const help = runGateway(args);
      expect(help.exitCode).toBe(0);
      expect(text(help.stdout)).toContain("gateway budget-add");
      expect(text(help.stdout)).toContain("--max-input-tokens");
      expect(text(help.stderr)).toBe("");
    }

    const version = runGateway(["--version"]);
    expect(version.exitCode).toBe(0);
    expect(text(version.stdout).trim()).toBe(gatewayVersion);
    expect(text(version.stderr)).toBe("");
  });
});
