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
if (!backendSource.includes("assertNoLegacyStorageMode")) {
  fail("backend.ts does not reject legacy STORAGE_MODE env vars");
}
if (!backendSource.includes("was removed")) {
  fail("backend.ts does not state the STORAGE_MODE removal guidance");
}

// STORAGE_MODE may exist in the kit ONLY inside backend.ts's legacyModeKeys
// rejection list; anywhere else it is dead mode vocabulary.
const backendLines = backendSource.split("\n");
const blockStart = backendSource.indexOf("function legacyModeKeys(");
if (blockStart === -1) {
  fail("backend.ts does not define the legacyModeKeys rejection list");
}
const blockEnd = backendSource.indexOf("\n}", blockStart);
let offset = 0;
const lineStarts = [];
for (const line of backendLines) {
  lineStarts.push(offset);
  offset += line.length + 1;
}
for (let index = 0; index < backendLines.length; index += 1) {
  if (!backendLines[index].includes("STORAGE_MODE")) continue;
  const start = lineStarts[index];
  if (start < blockStart || start > blockEnd) {
    fail(`backend.ts:${index + 1} carries STORAGE_MODE outside the legacyModeKeys rejection list`);
  }
}
for (const file of ["tls.ts", "query.ts", "pool.ts", "migrations.ts", "health.ts", "index.ts", "own.ts"]) {
  const source = readFileSync(join(kitDir, file), "utf8");
  if (source.includes("STORAGE_MODE")) {
    fail(`${file} contains STORAGE_MODE (backend.ts rejection list only)`);
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
