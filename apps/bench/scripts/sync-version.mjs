#!/usr/bin/env bun
// Regenerates src/lib/version.ts from package.json so the CLI-reported version
// (VERSION) can never drift from the published package version. Run as the first
// step of `build` (and therefore `prepublishOnly`).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const target = join(root, "src", "lib", "version.ts");
const next = `// AUTO-GENERATED from package.json by scripts/sync-version.mjs — do not edit by hand.\nexport const VERSION = ${JSON.stringify(pkg.version)};\n`;

let current = "";
try {
  current = readFileSync(target, "utf8");
} catch {
  // file does not exist yet; will be created below
}

if (current !== next) {
  writeFileSync(target, next);
}
console.log(`sync-version: VERSION -> ${pkg.version}`);
