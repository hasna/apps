#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), "loops-artifact-scan-"));
const contractsBin = join(repoRoot, "node_modules", ".bin", "contracts");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed\n${output}`);
  }
  return result.stdout.trim();
}

try {
  const packed = run("bun", [
    "pm",
    "pack",
    "--destination",
    workspace,
    "--ignore-scripts",
    "--quiet",
  ]);
  const fallbackArchive = readdirSync(workspace).find((entry) => entry.endsWith(".tgz"));
  const archive = packed
    ? isAbsolute(packed) ? packed : join(workspace, packed)
    : fallbackArchive ? join(workspace, fallbackArchive) : null;
  if (!archive) throw new Error("bun pack did not create a package tarball");

  const output = run(contractsBin, [
    "artifact-scan",
    archive,
    "--manifest",
    join(repoRoot, "hasna.contract.json"),
  ]);
  if (output) console.log(output);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
