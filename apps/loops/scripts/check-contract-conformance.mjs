#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runRepoConformance } from "@hasna/contracts";
import { contractHealthResponse } from "../src/api/index.ts";

export const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

// SEAM: the INSTALLED @hasna/contracts conformance harness still expects the
// retired deployment-mode env value; the runtime maps it onto the backend
// switch (self_hosted -> http client / "cloud" wire mode). Update to the
// canonical `http` value when the mode-free contracts release ships.
const conformanceEnv = {
  HASNA_LOOPS_STORAGE_MODE: "self_hosted",
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function runRawContractConformance(root = repoRoot) {
  return runRepoConformance(root, {
    env: conformanceEnv,
    healthSample: contractHealthResponse(conformanceEnv),
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
  const matched = exactBinCompatibilityWaiver(root, official);
  const checks = official.checks.map((check) => {
    if (!matched || check !== matched.officialCheck) return { ...check };
    return {
      ...check,
      status: "pass",
      detail:
        `waived exact published compatibility bin ${matched.waiver.bin} -> ` +
        `${matched.waiver.packageTarget}; official result: ${check.detail}`,
    };
  });
  const adjudications = matched
    ? [
        {
          checkId: matched.waiver.checkId,
          bin: matched.waiver.bin,
          packageTarget: matched.waiver.packageTarget,
          exportPath: matched.waiver.exportPath,
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
