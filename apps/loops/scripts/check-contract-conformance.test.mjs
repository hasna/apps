import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeLoopClientTransport } from "../src/lib/mode.ts";
import {
  formatContractConformance,
  repoRoot,
  runContractConformance,
} from "./check-contract-conformance.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function conformanceFixture(mutatePackage) {
  const root = mkdtempSync(join(tmpdir(), "loops-contract-conformance-"));
  const manifest = readJson(join(repoRoot, "hasna.contract.json"));
  const packageJson = readJson(join(repoRoot, "package.json"));
  mutatePackage(packageJson);
  writeFileSync(
    join(root, "hasna.contract.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  return root;
}

describe("Loops repository contract conformance", () => {
  test("preserves the official loops-api failure and applies only its documented compatibility waiver", () => {
    const report = runContractConformance();
    const rawBinCheck = report.official.checks.find(
      ({ id }) => id === "bins_match_package",
    );
    const adjudicatedBinCheck = report.checks.find(
      ({ id }) => id === "bins_match_package",
    );

    expect(report).toMatchObject({
      ok: true,
      repoRoot,
      name: "loops",
      class: "service",
    });
    expect(report.official).toMatchObject({
      ok: false,
      repoRoot,
      name: "loops",
      class: "service",
    });
    expect(rawBinCheck).toEqual({
      id: "bins_match_package",
      status: "fail",
      detail: "in package.json but undeclared: loops-api",
    });
    expect(adjudicatedBinCheck).toEqual({
      id: "bins_match_package",
      status: "pass",
      detail:
        "waived exact published compatibility bin loops-api -> dist/api/index.js; official result: in package.json but undeclared: loops-api",
    });
    expect(report.adjudications).toEqual([
      {
        checkId: "bins_match_package",
        bin: "loops-api",
        packageTarget: "dist/api/index.js",
        exportPath: "./api",
      },
    ]);
    expect(
      report.official.checks.find(({ id }) => id === "health_shape"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.filter(({ status }) => status === "fail"),
    ).toEqual([]);
  });

  test("leaves an unwaived extra package bin fatal", () => {
    const root = conformanceFixture((packageJson) => {
      packageJson.bin["loops-unwaived"] = "dist/unwaived/index.js";
    });
    try {
      const report = runContractConformance(root);
      expect(report.ok).toBe(false);
      expect(
        report.checks.find(({ id }) => id === "bins_match_package"),
      ).toEqual({
        id: "bins_match_package",
        status: "fail",
        detail:
          "in package.json but undeclared: loops-api, loops-unwaived",
      });
      expect(report.adjudications).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("requires the waived bin target and package export to match exactly", () => {
    const mutations = [
      (packageJson) => {
        packageJson.bin["loops-api"] = "dist/other/index.js";
      },
      (packageJson) => {
        packageJson.exports["./api"].import = "./dist/other/index.js";
      },
      (packageJson) => {
        packageJson.exports["./api"].types = "./dist/other/index.d.ts";
      },
    ];
    for (const mutatePackage of mutations) {
      const root = conformanceFixture(mutatePackage);
      try {
        const report = runContractConformance(root);
        expect(report.ok).toBe(false);
        expect(
          report.checks.find(({ id }) => id === "bins_match_package"),
        ).toMatchObject({ status: "fail" });
        expect(report.adjudications).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("declares the exact package, deployment, and split DSN contracts", () => {
    const packageJson = readJson(join(repoRoot, "package.json"));
    const manifest = readJson(join(repoRoot, "hasna.contract.json"));
    const httpSurface = manifest.serviceSurfaces.find(
      ({ name }) => name === "http",
    );
    const serviceMetadata = manifest.metadata.service;
    const serveSource = readFileSync(
      join(repoRoot, "src", "serve", "index.ts"),
      "utf8",
    );
    const serveDatabaseEnvNames = [
      ...new Set(
        serveSource.match(
          /HASNA_LOOPS_(?:AUTH_|MIGRATOR_)?DATABASE_URL/g,
        ) ?? [],
      ),
    ].sort();

    expect(packageJson.bin["loops-api"]).toBe("dist/api/index.js");
    expect(packageJson.exports["./api"]).toEqual({
      types: "./dist/api/index.d.ts",
      import: "./dist/api/index.js",
    });
    // SEAM: hasna.contract.json still declares the retired deployment-mode
    // fields because the INSTALLED @hasna/contracts schema requires them. The
    // manifest is rewritten when the mode-free contracts release ships; until
    // then these literals pin the seam and the runtime must keep mapping the
    // retired value onto the backend switch.
    expect(httpSurface.deploymentModes).toEqual(["self-hosted"]);
    expect(serviceMetadata.deploymentModeMapping).toEqual({
      contract: "self-hosted",
      runtime: "self_hosted",
    });
    expect(
      normalizeLoopClientTransport(serviceMetadata.deploymentModeMapping.runtime),
    ).toBe("http");

    expect(manifest.storage.databaseUrlSecretRef).toBeUndefined();
    expect(
      serviceMetadata.databaseDsnBindings.map(
        ({ environmentVariable }) => environmentVariable,
      ).sort(),
    ).toEqual(serveDatabaseEnvNames);
    expect(serviceMetadata.databaseDsnBindings).toEqual([
      {
        purpose: "runtime",
        environmentVariable: "HASNA_LOOPS_DATABASE_URL",
        secretRef: "hasna/oss/loops/runtime-database-url",
      },
      {
        purpose: "auth",
        environmentVariable: "HASNA_LOOPS_AUTH_DATABASE_URL",
        secretRef: "hasna/oss/loops/auth-database-url",
      },
      {
        purpose: "migrator",
        environmentVariable: "HASNA_LOOPS_MIGRATOR_DATABASE_URL",
        secretRef: "hasna/oss/loops/migrator-database-url",
      },
    ]);
  });

  test("normalizes checkout roots in formatted conformance JSON", () => {
    const report = runContractConformance();
    const formatted = formatContractConformance(report);
    const parsed = JSON.parse(formatted);

    expect(formatted).not.toContain(repoRoot);
    expect(parsed.repoRoot).toBe(".");
    expect(parsed.official.repoRoot).toBe(".");
  });
});
