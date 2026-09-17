#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const generatedPath = join(packageRoot, "src", "sdk", "client.ts");
const before = readFileSync(generatedPath);
let after: Buffer;
let result: ReturnType<typeof Bun.spawnSync>;

try {
  result = Bun.spawnSync({
    cmd: ["bun", "run", "scripts/generate-sdk.ts"],
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  after = readFileSync(generatedPath);
} finally {
  writeFileSync(generatedPath, before);
}

if (result!.exitCode !== 0) {
  process.stdout.write(result!.stdout);
  process.stderr.write(result!.stderr);
  process.exit(result!.exitCode);
}
if (!before.equals(after!)) {
  console.error("Projects generated SDK is stale. Run `bun run sdk:generate` and commit src/sdk/client.ts.");
  process.exit(1);
}
console.log("pass projects generated SDK is byte-identical");
