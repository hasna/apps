import { resolve } from "node:path";
import {
  GENERATED_OUTPUTS,
  assertExactGeneratedOutputInventory,
  assertGeneratedEntrypointsCovered,
} from "./generated-output-manifest.js";

const packageRoot = resolve(import.meta.dir, "..");

assertExactGeneratedOutputInventory(packageRoot);
assertGeneratedEntrypointsCovered(packageRoot);

const tracked = Bun.spawnSync(["git", "ls-files", "--", ...GENERATED_OUTPUTS], {
  cwd: packageRoot,
  stdout: "pipe",
  stderr: "pipe",
});
if (tracked.exitCode !== 0) {
  throw new Error(`git ls-files failed\n${tracked.stderr.toString()}`);
}
const trackedOutputs = new Set(tracked.stdout.toString().trim().split("\n").filter(Boolean));
const untrackedExpected = GENERATED_OUTPUTS.filter((file) => !trackedOutputs.has(file));
if (untrackedExpected.length > 0) {
  throw new Error(`expected generated outputs are not tracked: ${untrackedExpected.join(", ")}`);
}

const status = Bun.spawnSync(["git", "status", "--porcelain=v1", "--untracked-files=all", "--", "dist", "types"], {
  cwd: packageRoot,
  stdout: "pipe",
  stderr: "pipe",
});
if (status.exitCode !== 0) {
  throw new Error(`git status failed\n${status.stderr.toString()}`);
}
if (status.stdout.length > 0) {
  throw new Error(`generated artifacts differ from the committed outputs\n${status.stdout.toString()}`);
}

console.log(`verified ${GENERATED_OUTPUTS.length} tracked generated outputs and every package.json entrypoint`);
