#!/usr/bin/env bun
// Publish gate (todos a403124e): refuse to publish an artifact whose
// self-reported gatewayVersion disagrees with package.json. Release PR #25
// bumped package.json only, so the published 0.1.7 answers `gateway --version`
// with 0.1.6 — this exact skew, unchecked at publish time.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const source = readFileSync(join(root, "src", "version.ts"), "utf8");
const match = source.match(/gatewayVersion\s*=\s*"([^"]+)"/);

if (!match) {
  console.error("VERSION_PARITY_FAILED: gatewayVersion not found in src/version.ts");
  process.exit(1);
}
if (match[1] !== manifest.version) {
  console.error(
    `VERSION_PARITY_FAILED: src/version.ts gatewayVersion=${match[1]} != package.json version=${manifest.version}`,
  );
  process.exit(1);
}
console.log(`version parity ok: ${manifest.version}`);
