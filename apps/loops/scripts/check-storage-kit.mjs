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
if (backendCode.includes("resolveStorageMode")) {
  fail("backend.ts contains resolveStorageMode (kit 1.0.2 carries no mode vocabulary)");
}
if (backendCode.includes("STORAGE_MODE")) {
  fail("backend.ts contains STORAGE_MODE (kit 1.0.2 carries no mode vocabulary)");
}

// Kit 1.0.2 declares PostgreSQL as the ONLY contract server backend
// (SERVER_DATA_BACKENDS = ["postgresql"]): the strict HealthResponseSchema and
// the server-backend resolver both know exactly one backend, and
// resolveServerDataBackend fails closed when HASNA_LOOPS_DATABASE_URL is
// absent. The app's local sqlite runtime is its own development posture,
// reported on the /health wire envelope as `storage`.
if (!backendCode.includes('SERVER_DATA_BACKENDS = ["postgresql"]')) {
  fail("backend.ts does not declare the postgresql-only contract backend enum");
}
if (backendCode.includes("sqlite")) {
  fail("backend.ts names sqlite; the kit 1.0.2 contract backend is postgresql only");
}

// The retired HASNA_LOOPS_STORAGE_MODE rejection was removed with the app's own
// env chain (hasna/apps#1720): the shared @hasna/contracts/client resolver owns
// the client connection, so no STORAGE_MODE vocabulary may appear anywhere in
// loops source any more — including runtime-config.ts, which is a plain
// env-presence report for server surfaces.
const runtimeConfigSource = readFileSync(join(repoRoot, "src/lib/runtime-config.ts"), "utf8");
const runtimeConfigCode = codeOnly(runtimeConfigSource);
if (runtimeConfigCode.includes("STORAGE_MODE")) {
  fail("runtime-config.ts still carries STORAGE_MODE vocabulary; the retired switch is fully removed");
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
