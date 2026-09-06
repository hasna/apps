#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runRepoConformance } from "@hasna/contracts";
import { contractHealthResponse } from "../src/api/index.ts";

export const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Doctrine: there is no HASNA_LOOPS_STORAGE_MODE. @hasna/contracts 1.0.2 makes
// PostgreSQL the only contract server backend (`server_backend_configuration`
// expects the resolver to fail closed when HASNA_LOOPS_DATABASE_URL is absent;
// `HealthResponseSchema.backend` is the literal "postgresql"). The env below
// stays empty so the backend-configuration check sees the fail-closed posture;
// process.env is never forwarded here.
const conformanceEnv = {};

// The strict health shape has exactly one representable server backend
// ("postgresql"), so the health sample comes from the contract-CONFIGURED
// posture — a server with HASNA_LOOPS_DATABASE_URL declared. The app's own
// sqlite runtime is a non-contract development posture; the /health wire
// envelope reports it as `storage` (see src/api/index.ts), outside the strict
// schema's vocabulary.
const CONFIGURED_SERVER_ENV = {
  HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops",
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function runRawContractConformance(root = repoRoot) {
  return runRepoConformance(root, {
    env: conformanceEnv,
    healthSample: contractHealthResponse(CONFIGURED_SERVER_ENV),
  });
}

function exactBinCompatibilityWaiver(root, official) {
  let manifest;
  let packageJson;
  try {
    manifest = readJson(join(root, "hasna.contract.json"));
    packageJson = readJson(join(root, "package.json"));
  } catch {
    return null;
  }

  const waivers =
    manifest.metadata?.conformance?.binCompatibilityWaivers;
  if (!Array.isArray(waivers) || waivers.length !== 1) return null;
  const waiver = waivers[0];
  if (
    waiver?.checkId !== "bins_match_package" ||
    typeof waiver.failureDetail !== "string" ||
    typeof waiver.bin !== "string" ||
    typeof waiver.packageTarget !== "string" ||
    typeof waiver.exportPath !== "string" ||
    typeof waiver.exportImport !== "string" ||
    typeof waiver.exportTypes !== "string" ||
    typeof waiver.reason !== "string" ||
    waiver.reason.trim() === ""
  ) {
    return null;
  }

  const officialCheck = official.checks.find(
    ({ id }) => id === waiver.checkId,
  );
  const packageExport = packageJson.exports?.[waiver.exportPath];
  if (
    officialCheck?.status !== "fail" ||
    officialCheck.detail !== waiver.failureDetail ||
    manifest.bins?.includes(waiver.bin) ||
    packageJson.bin?.[waiver.bin] !== waiver.packageTarget ||
    waiver.exportImport !== `./${waiver.packageTarget}` ||
    packageExport?.import !== waiver.exportImport ||
    packageExport?.types !== waiver.exportTypes
  ) {
    return null;
  }

  return {
    waiver,
    officialCheck,
  };
}

export function runContractConformance(root = repoRoot) {
  const official = runRawContractConformance(root);
  const binMatched = exactBinCompatibilityWaiver(root, official);
  const checks = official.checks.map((check) => {
    if (binMatched && check === binMatched.officialCheck) {
      return {
        ...check,
        status: "pass",
        detail:
          `waived exact published compatibility bin ${binMatched.waiver.bin} -> ` +
          `${binMatched.waiver.packageTarget}; official result: ${check.detail}`,
      };
    }
    return { ...check };
  });
  const adjudications = binMatched
    ? [
        {
          checkId: binMatched.waiver.checkId,
          bin: binMatched.waiver.bin,
          packageTarget: binMatched.waiver.packageTarget,
          exportPath: binMatched.waiver.exportPath,
        },
      ]
    : [];

  return {
    ok: checks.every(({ status }) => status !== "fail"),
    repoRoot: official.repoRoot,
    name: official.name,
    class: official.class,
    checks,
    official,
    adjudications,
  };
}

export function formatContractConformance(report) {
  return `${JSON.stringify(
    report,
    (key, value) => (key === "repoRoot" ? "." : value),
    2,
  )}\n`;
}

if (import.meta.main) {
  const report = runContractConformance();
  process.stdout.write(formatContractConformance(report));
  if (!report.ok) process.exitCode = 1;
}
