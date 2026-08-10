#!/usr/bin/env bun
// Publish gate (todos 5283d08b): refuse to pack an artifact whose self-reported
// PACKAGE_VERSION disagrees with package.json. The 0.1.2 publish shipped a dist
// that answers `capacity version` with 0.1.1 because this exact skew existed at
// pack time and nothing checked it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const source = readFileSync(join(root, "src", "version.ts"), "utf8");
const match = source.match(/PACKAGE_VERSION\s*=\s*"([^"]+)"/);

if (!match) {
  console.error("VERSION_PARITY_FAILED: PACKAGE_VERSION not found in src/version.ts");
  process.exit(1);
}
if (match[1] !== manifest.version) {
  console.error(
    `VERSION_PARITY_FAILED: src/version.ts PACKAGE_VERSION=${match[1]} != package.json version=${manifest.version}`,
  );
  process.exit(1);
}
console.log(`version parity ok: ${manifest.version}`);
