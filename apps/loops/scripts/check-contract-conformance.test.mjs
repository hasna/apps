import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOOP_DEPLOYMENT_MODES,
  normalizeLoopDeploymentMode,
} from "../src/lib/mode.ts";
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
  test("passes official conformance without a bin compatibility waiver", () => {
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
      ok: true,
      repoRoot,
      name: "loops",
      class: "service",
    });
    expect(rawBinCheck).toEqual({
      id: "bins_match_package",
      status: "pass",
      detail: "declared bins match package.json bin",
    });
    expect(adjudicatedBinCheck).toEqual(rawBinCheck);
    expect(report.adjudications).toEqual([]);
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
        detail: "in package.json but undeclared: loops-unwaived",
      });
      expect(report.adjudications).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("declares the exact package, deployment, and split DSN contracts", () => {
    const packageJson = readJson(join(repoRoot, "package.json"));
    const manifest = readJson(join(repoRoot, "hasna.contract.json"));
    const surfaces = Object.fromEntries(
      manifest.serviceSurfaces.map((surface) => [surface.kind, surface]),
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

    expect(packageJson.bin["loops-api"]).toBeUndefined();
    expect(packageJson.exports["./api"]).toEqual({
      types: "./dist/api/index.d.ts",
      import: "./dist/api/index.js",
    });
    expect(surfaces.api.deploymentModes).toEqual(["self-hosted"]);
    expect(surfaces.sdk).toMatchObject({
      status: "supported",
      exportSubpath: "./sdk",
      generatedFrom: "/openapi.json",
      clientClassName: "LoopsClient",
    });
    expect(surfaces.mcp).toMatchObject({
      status: "supported",
      mcpBin: "loops-mcp",
    });
    expect(surfaces.cli).toMatchObject({
      status: "supported",
      bin: "loops",
    });
    expect(manifest.storage).toMatchObject({
      engines: ["sqlite", "postgres"],
      pgTestGate: {
        envVar: "LOOPS_TEST_DATABASE_URL",
        command:
          "bun test --timeout 60000 src/lib/storage/postgres-loop-storage.test.ts src/lib/storage/postgres-loop-storage-tenant-guard.test.ts",
      },
    });
    expect(manifest.metadata.release).toEqual({
      artifactScan: { script: "scan:artifact" },
    });
    expect(packageJson.scripts.prepack).toContain("scan:artifact");
    expect(JSON.stringify(manifest)).not.toContain("secretRef");
    expect(serviceMetadata.deploymentModeMapping).toEqual({
      contract: "self-hosted",
      runtime: "self_hosted",
    });
    expect(
      LOOP_DEPLOYMENT_MODES.includes(
        normalizeLoopDeploymentMode(
          serviceMetadata.deploymentModeMapping.runtime,
        ),
      ),
    ).toBe(true);

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
      },
      {
        purpose: "auth",
        environmentVariable: "HASNA_LOOPS_AUTH_DATABASE_URL",
      },
      {
        purpose: "migrator",
        environmentVariable: "HASNA_LOOPS_MIGRATOR_DATABASE_URL",
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
