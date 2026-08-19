import { expect, test } from "bun:test";
import { lstatSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveContractsCli } from "./contracts-cli.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(scriptsDir);
const runner = join(scriptsDir, "contracts-cli.mjs");
const shim = join(packageRoot, "node_modules", ".bin", "contracts");
const hiddenShim = `${shim}.clean-install-test-hidden`;

test("resolves and runs the pinned contracts CLI without a package-local bin shim", () => {
  const cli = resolveContractsCli();
  const contractsPackage = JSON.parse(
    readFileSync(fileURLToPath(import.meta.resolve("@hasna/contracts/package.json")), "utf8"),
  ) as { version: string };

  expect(cli).toEndWith(join("dist", "cli", "index.js"));
  expect(cli).not.toContain(join("node_modules", ".bin"));

  let shimMoved = false;
  try {
    lstatSync(shim);
    renameSync(shim, hiddenShim);
    shimMoved = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  try {
    const result = Bun.spawnSync([process.execPath, runner, "--version"], {
      cwd: packageRoot,
      env: { ...process.env, PATH: "/usr/bin:/bin" },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe(contractsPackage.version);
  } finally {
    if (shimMoved) renameSync(hiddenShim, shim);
  }
});
