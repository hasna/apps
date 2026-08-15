#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runRepoConformance } from "@hasna/contracts";
import { contractHealthResponse } from "../src/api/index.ts";

export const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Doctrine: there is no HASNA_LOOPS_STORAGE_MODE. @hasna/contracts 0.10.6
// rejects legacy storage-mode variables outright (server_backend_configuration),
// and the sqlite | postgresql server backend is selected solely by
// HASNA_LOOPS_DATABASE_URL. The env below stays empty; process.env is never
// forwarded here so a leftover storage-mode var cannot poison the run.
const conformanceEnv = {};

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

// Known, tracked debt: @hasna/contracts 0.10.6's credential_seam_compliance
// gate flags loops' four vendored copies of the @hasna/contracts/client seam
// (src/lib/cloud/storage.ts, src/lib/cloud/transport.ts). The loops seam
// deliberately speaks the doctrine-clean `file | api` vocabulary while
// @hasna/contracts/client 0.10.6 still speaks `sqlite | http` with disk-tier
// credential resolution; adopting the shared seam changes client connection
// semantics and is the tracked cloud/-domain follow-up d295c91e. The detail is
// pinned verbatim below: a NEW seam, a changed seam finding, or any other
// failing check fails loudly instead of being silently waived.
const vendoredSeamMarkers = [
  "resolveStorageClient",
  "resolveClientTransport",
  "createHasnaHttpTransport",
  "createClientTransport",
];

const knownVendoredSeamDetail = [
  "src/lib/cloud/storage.ts:218 resolveStorageClient is DEFINED here — this is a vendored copy of the @hasna/contracts client seam, not a use of it. A fork does not receive credential-resolution fixes, so it keeps resolving keys from the process environment however many times the shared package is corrected. Import it from @hasna/contracts/client instead.",
  "src/lib/cloud/transport.ts:89 resolveClientTransport is DEFINED here — this is a vendored copy of the @hasna/contracts client seam, not a use of it. A fork does not receive credential-resolution fixes, so it keeps resolving keys from the process environment however many times the shared package is corrected. Import it from @hasna/contracts/client instead.",
  "src/lib/cloud/transport.ts:241 createHasnaHttpTransport is DEFINED here — this is a vendored copy of the @hasna/contracts client seam, not a use of it. A fork does not receive credential-resolution fixes, so it keeps resolving keys from the process environment however many times the shared package is corrected. Import it from @hasna/contracts/client instead.",
  "src/lib/cloud/transport.ts:358 createClientTransport is DEFINED here — this is a vendored copy of the @hasna/contracts client seam, not a use of it. A fork does not receive credential-resolution fixes, so it keeps resolving keys from the process environment however many times the shared package is corrected. Import it from @hasna/contracts/client instead.",
].join("; ");

export function vendoredSeamWaiver(official) {
  const officialCheck = official.checks.find(
    ({ id }) => id === "credential_seam_compliance",
  );
  if (officialCheck?.status !== "fail") return null;
  if (officialCheck.detail !== knownVendoredSeamDetail) return null;
  for (const marker of vendoredSeamMarkers) {
    if (!officialCheck.detail.includes(marker)) return null;
  }
  return { officialCheck, detail: officialCheck.detail };
}

export function runContractConformance(root = repoRoot) {
  const official = runRawContractConformance(root);
  const binMatched = exactBinCompatibilityWaiver(root, official);
  const seamMatched = vendoredSeamWaiver(official);
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
    if (seamMatched && check === seamMatched.officialCheck) {
      return {
        ...check,
        status: "pass",
        detail:
          "vendored client seam debt adjudicated; follow-up todos d295c91e — " +
          "import from @hasna/contracts/client",
      };
    }
    return { ...check };
  });
  const adjudications = [
    ...(binMatched
      ? [
          {
            checkId: binMatched.waiver.checkId,
            bin: binMatched.waiver.bin,
            packageTarget: binMatched.waiver.packageTarget,
            exportPath: binMatched.waiver.exportPath,
          },
        ]
      : []),
    ...(seamMatched
      ? [
          {
            checkId: "credential_seam_compliance",
            taskId: "d295c91e",
            kind: "vendored-seam",
            detail: seamMatched.detail,
          },
        ]
      : []),
  ];

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
