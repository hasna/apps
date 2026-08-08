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
  test("passes official bin conformance without a loops-api compatibility waiver", () => {
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

  test("does not retain a loops-api compatibility waiver", () => {
    const manifest = readJson(join(repoRoot, "hasna.contract.json"));

    expect(manifest.metadata.conformance?.binCompatibilityWaivers).toBeUndefined();
  });

  test("declares the exact package, storage, and split DSN contracts", () => {
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

    expect(packageJson.bin["loops-api"]).toBeUndefined();
    expect(packageJson.exports["./api"]).toEqual({
      types: "./dist/api/index.d.ts",
      import: "./dist/api/index.js",
    });
    // The local|self_hosted|cloud placement axis was removed from the contract
    // schema. These assert the dead vocabulary stays gone rather than pinning it.
    expect(manifest.deploymentModes).toBeUndefined();
    expect(httpSurface.deploymentModes).toBeUndefined();
    expect(httpSurface.deploymentMode).toBeUndefined();
    expect(serviceMetadata.deploymentModeMapping).toBeUndefined();

    // The only technical switch is the SERVER data backend. `loops-serve` opens
    // Postgres unconditionally — src/serve/index.ts resolves the runtime DSN and
    // throws when it is absent, and imports no sqlite storage — so the active
    // backend is postgresql. sqlite remains a supported engine for the CLI client,
    // which is what `engines` records.
    expect(manifest.storage.mode).toBeUndefined();
    expect(manifest.storage.backend).toBe("postgresql");
    expect(manifest.storage.engines).toEqual(["sqlite", "postgresql"]);
    expect(serveSource).toContain("HASNA_LOOPS_DATABASE_URL");
    expect(serveSource).not.toContain("storage/sqlite");

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
