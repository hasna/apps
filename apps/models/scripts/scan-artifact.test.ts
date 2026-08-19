import { expect, test } from "bun:test";
import { sep } from "node:path";
import { resolveContractsCli } from "./scan-artifact.ts";

test("resolves the pinned contracts CLI without a package-local bin shim", () => {
  const cli = resolveContractsCli();

  expect(cli.endsWith(`${sep}dist${sep}cli${sep}index.js`)).toBe(true);
  expect(cli.includes(`${sep}node_modules${sep}.bin${sep}`)).toBe(false);
});

test("runs the resolved contracts CLI with a stripped PATH", () => {
  const result = Bun.spawnSync([process.execPath, resolveContractsCli(), "--version"], {
    env: { ...process.env, PATH: "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stdout)).toContain("0.11.1");
});
