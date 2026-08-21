#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const kitDir = join(repoRoot, "src/generated/storage-kit");
const manifestPath = join(kitDir, ".storage-kit-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const pinnedContracts = packageJson.dependencies?.["@hasna/contracts"];
const expectedVersion = pinnedContracts;

function fail(message) {
  console.error(`storage-kit check failed: ${message}`);
  process.exitCode = 1;
}

if (
  typeof expectedVersion !== "string" ||
  /^[~^]/.test(expectedVersion)
) {
  fail("@hasna/contracts must be pinned exact in package.json (no ^ or ~)");
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

/** Strip // and /* *\/ comments so policy scans inspect code, not prose. */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const backendSource = readFileSync(join(kitDir, "backend.ts"), "utf8");
const backendCode = codeOnly(backendSource);

const forbidden = [
  "STORAGE_MODES",
  "storageEnvKeys",
  "modeKeys",
  "resolveStorageMode",
  "createCloudPoolFromEnv",
  "DEPRECATED_STORAGE_MODE_ALIASES",
  "deprecatedAlias",
  "Using alias env",
  "remote",
  "hybrid",
  "self_hosted",
];
for (const token of forbidden) {
  if (backendCode.includes(token)) {
    fail(`backend.ts contains forbidden compatibility token ${JSON.stringify(token)}`);
  }
}
if (!backendCode.includes('SERVER_DATA_BACKENDS = ["sqlite", "postgresql"]')) {
  fail("backend.ts does not declare the sqlite | postgresql backend enum");
}
if (backendSource.includes("assertNoLegacyStorageMode") || backendSource.includes("legacyModeKeys")) {
  fail("backend.ts still carries the removed kit-level legacy-mode machinery");
}
if (backendSource.includes("STORAGE_MODE")) {
  fail("backend.ts contains STORAGE_MODE (kit 0.13.3 carries no mode vocabulary)");
}

// Legacy STORAGE_MODE rejection moved to the app layer when the kit contract
// evolved (kit 0.13.3 emits backend.ts with no mode vocabulary at all): the
// app's runtime-config.ts hard-rejects HASNA_LOOPS_STORAGE_MODE. Assert the
// doctrine where it lives now, and forbid STORAGE_MODE anywhere else in
// runtime-config.ts.
const runtimeConfigSource = readFileSync(join(repoRoot, "src/lib/runtime-config.ts"), "utf8");
if (!runtimeConfigSource.includes("assertNoRetiredStorageMode")) {
  fail("runtime-config.ts does not reject the retired HASNA_LOOPS_STORAGE_MODE env");
}
if (!runtimeConfigSource.includes("is retired and must be removed")) {
  fail("runtime-config.ts does not state the STORAGE_MODE removal guidance");
}
const runtimeConfigCode = codeOnly(runtimeConfigSource);
const modeBlockStart = runtimeConfigCode.indexOf("const STORAGE_MODE_ENV_KEYS");
if (modeBlockStart === -1) {
  fail("runtime-config.ts does not define the retired STORAGE_MODE env-keys list");
}
const modeFnStart = runtimeConfigCode.indexOf("export function assertNoRetiredStorageMode");
const modeBlockEnd = modeFnStart === -1 ? -1 : runtimeConfigCode.indexOf("\n}", modeFnStart);
const rcLineStarts = [];
{
  let rcOffset = 0;
  for (const line of runtimeConfigCode.split("\n")) {
    rcLineStarts.push(rcOffset);
    rcOffset += line.length + 1;
  }
}
for (let index = 0; index < rcLineStarts.length; index += 1) {
  const start = rcLineStarts[index];
  const end = start + (index < rcLineStarts.length - 1 ? rcLineStarts[index + 1] - start : runtimeConfigCode.length - start);
  const line = runtimeConfigCode.slice(start, end);
  if (!line.includes("STORAGE_MODE")) continue;
  if (start < modeBlockStart || start > modeBlockEnd) {
    fail(`runtime-config.ts:${index + 1} carries STORAGE_MODE outside the retired-keys rejection list`);
  }
}
for (const file of ["tls.ts", "query.ts", "pool.ts", "migrations.ts", "health.ts", "index.ts", "own.ts"]) {
  const source = readFileSync(join(kitDir, file), "utf8");
  if (source.includes("STORAGE_MODE")) {
    fail(`${file} contains STORAGE_MODE (the kit carries no mode vocabulary)`);
  }
}

const poolSource = readFileSync(join(kitDir, "pool.ts"), "utf8");
if (!poolSource.includes("export function createServerPoolFromEnv")) {
  fail("pool.ts does not export createServerPoolFromEnv");
}
if (poolSource.includes("createCloudPoolFromEnv")) {
  fail("pool.ts still exposes the removed createCloudPoolFromEnv factory");
}

const tlsSource = readFileSync(join(kitDir, "tls.ts"), "utf8");
const tlsCode = codeOnly(tlsSource);
if (/rejectUnauthorized:\s*false/.test(tlsCode)) {
  fail("tls.ts contains an unverified TLS configuration");
}
if (!tlsCode.includes("rejectUnauthorized: true")) {
  fail("tls.ts never builds a verified TLS configuration");
}
if (!tlsSource.includes("export function resolveTlsConfig")) {
  fail("tls.ts does not export resolveTlsConfig");
}

if (!process.exitCode) {
  console.log(`ok storage-kit strict check (expected v${expectedVersion}) ${kitDir}`);
}
