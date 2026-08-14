#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);

function addCandidate(candidates, root) {
  if (!root || candidates.includes(root)) return;
  candidates.push(root);
}

function candidateFromPackageBin(binPath) {
  const resolved = resolve(binPath);
  const parts = resolved.split(sep);
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex >= 0 && parts[nodeModulesIndex + 1] === ".bin") {
    const nodeModulesRoot = parts.slice(0, nodeModulesIndex + 1).join(sep) || sep;
    return join(nodeModulesRoot, "@hasna", "shield");
  }

  const packageRoot = dirname(dirname(resolved));
  return join(dirname(packageRoot), "shield");
}

function findInstalledSibling(startPath) {
  let dir = dirname(resolve(startPath));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "node_modules", "@hasna", "shield");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

function resolveShieldRoot(binName) {
  const candidates = [];
  const invokedBin = process.argv[1];
  if (invokedBin) {
    addCandidate(candidates, candidateFromPackageBin(invokedBin));
    addCandidate(candidates, findInstalledSibling(invokedBin));

    if (existsSync(invokedBin)) {
      const realInvokedBin = realpathSync(invokedBin);
      addCandidate(candidates, candidateFromPackageBin(realInvokedBin));
      addCandidate(candidates, findInstalledSibling(realInvokedBin));
    }
  }

  addCandidate(candidates, candidateFromPackageBin(thisFile));
  addCandidate(candidates, findInstalledSibling(thisFile));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "bin", `${binName}.sh`))) return candidate;
  }

  throw new Error(`Unable to locate @hasna/shield bin/${binName}.sh`);
}

export function forwardShieldBin(binName) {
  const shieldRoot = resolveShieldRoot(binName);
  const target = join(shieldRoot, "bin", `${binName}.sh`);
  const result = spawnSync("sh", [target, ...process.argv.slice(2)], {
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Failed to launch ${binName}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.signal) process.kill(process.pid, result.signal);
  process.exit(result.status ?? 1);
}
