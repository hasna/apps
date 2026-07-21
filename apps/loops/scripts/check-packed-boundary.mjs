#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed\n${output}`);
  }
  return result;
}

const tempRoot = mkdtempSync(join(tmpdir(), "loops-packed-boundary-"));
const extractRoot = join(tempRoot, "extract");

try {
  run("bun", [
    "pm",
    "pack",
    "--destination",
    tempRoot,
    "--ignore-scripts",
    "--quiet",
  ]);

  const archiveName = readdirSync(tempRoot).find((entry) => entry.endsWith(".tgz"));
  if (!archiveName) {
    throw new Error("bun pack did not create a package tarball");
  }

  mkdirSync(extractRoot);
  run("tar", ["-xzf", join(tempRoot, archiveName), "-C", extractRoot]);

  const packageRoot = join(extractRoot, "package");
  if (!existsSync(packageRoot)) {
    throw new Error("packed package did not contain the expected package root");
  }

  const scan = run("bun", [
    "run",
    "scripts/no-private-cloud-boundary.mjs",
    "--root",
    packageRoot,
  ]);
  process.stdout.write(scan.stdout);
  console.log("Loops packed artifact boundary scan passed");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
