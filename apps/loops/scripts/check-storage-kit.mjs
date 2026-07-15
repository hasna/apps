#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const kitDir = join(repoRoot, "src/generated/storage-kit");
const manifestPath = join(kitDir, ".storage-kit-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const expectedVersion = "0.5.2";

function fail(message) {
  console.error(`storage-kit check failed: ${message}`);
  process.exitCode = 1;
}

if (manifest.generator !== "@hasna/contracts vendor-kit") {
  fail(`unexpected generator ${JSON.stringify(manifest.generator)}`);
}
if (manifest.kitVersion !== expectedVersion) {
  fail(`expected kitVersion ${expectedVersion}, got ${JSON.stringify(manifest.kitVersion)}`);
}

for (const [file, expectedHash] of Object.entries(manifest.files ?? {})) {
  const content = readFileSync(join(kitDir, file));
  const actualHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (actualHash !== expectedHash) {
    fail(`${file} hash mismatch: expected ${expectedHash}, got ${actualHash}`);
  }
}

const modeSource = readFileSync(join(kitDir, "mode.ts"), "utf8");
const forbidden = [
  "DEPRECATED_STORAGE_MODE_ALIASES",
  "remote",
  "hybrid",
  "self_hosted",
  "deprecatedAlias",
  "Using alias env",
];
for (const token of forbidden) {
  if (modeSource.includes(token)) fail(`mode.ts contains forbidden compatibility token ${JSON.stringify(token)}`);
}
if (!modeSource.includes("There is no compatibility mode vocabulary.")) {
  fail("mode.ts does not declare the strict no-compatibility policy");
}

const tlsSource = readFileSync(join(kitDir, "tls.ts"), "utf8");
if (/rejectUnauthorized:\s*false/.test(tlsSource)) {
  fail("tls.ts contains an unverified TLS configuration");
}
if (!tlsSource.includes("requires verified TLS")) {
  fail("tls.ts does not declare the strict verified TLS policy");
}

if (!process.exitCode) {
  console.log(`ok storage-kit strict check (expected v${expectedVersion}) ${kitDir}`);
}
