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
import { contractHealthResponse } from "../src/api/index.ts";

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
  test("passes official bin conformance with no seam adjudication", () => {
    const report = runContractConformance();
    const rawBinCheck = report.official.checks.find(
      ({ id }) => id === "bins_match_package",
    );
    const adjudicatedBinCheck = report.checks.find(
      ({ id }) => id === "bins_match_package",
    );
    const officialSeamCheck = report.official.checks.find(
      ({ id }) => id === "credential_seam_compliance",
    );
    const seamCheck = report.checks.find(
      ({ id }) => id === "credential_seam_compliance",
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
      report.checks.find(({ id }) => id === "health_shape"),
    ).toMatchObject({ status: "pass" });
    // The vendored client seam is gone: the shared seam is imported from
    // @hasna/contracts/client, so the official check itself passes and no
    // adjudication (follow-up d295c91e) is needed.
    expect(seamCheck).toEqual(officialSeamCheck);
    expect(officialSeamCheck.status).toBe("pass");
    expect(report.checks.filter(({ status }) => status === "fail").map(({ id }) => id)).toEqual(
      [],
    );
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

  test("declares the doctrine-clean storage contract with no mode vocabulary", () => {
    const packageJson = readJson(join(repoRoot, "package.json"));
    const manifest = readJson(join(repoRoot, "hasna.contract.json"));
    const httpSurface = manifest.serviceSurfaces.find(
      ({ name }) => name === "http",
    );
    const sdkSurface = manifest.serviceSurfaces.find(
      ({ kind }) => kind === "sdk",
    );
    const mcpSurface = manifest.serviceSurfaces.find(
      ({ kind }) => kind === "mcp",
    );
    const cliSurface = manifest.serviceSurfaces.find(
      ({ kind }) => kind === "cli",
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
    expect(httpSurface.deploymentModes).toBeUndefined();
    expect(serviceMetadata.deploymentModeMapping).toBeUndefined();

    // Doctrine: no deployment-mode vocabulary anywhere in the public manifest.
    // The only technical switch is the server data backend (sqlite | postgresql).
    const manifestText = JSON.stringify(manifest);
    for (const token of ["deploymentModes", "deploymentModeMapping", "STORAGE_MODE", "self_hosted"]) {
      expect(manifestText).not.toContain(token);
    }

    expect(manifest.hosting).toEqual(["user-hosted"]);
    expect(manifest.storage.backend).toBe("sqlite");
    expect(manifest.storage.mode).toBeUndefined();
    expect(manifest.storage.engines).toEqual(["sqlite", "postgresql"]);
    expect(manifest.storage.envPrefix).toBe("HASNA_LOOPS_");
    expect(manifest.storage.sqlitePath).toBe("~/.hasna/loops/loops.db");
    expect(manifest.storage.pgTestGate).toEqual({
      envVar: "LOOPS_TEST_DATABASE_URL",
      command: "bun test src/lib/storage/postgres-loop-storage.test.ts",
    });
    expect(manifest.storage.databaseUrlSecretRef).toBeUndefined();

    // The 0.10.6 surface matrix declares api, sdk, mcp, and cli surfaces, all
    // bound to real package.json bins and exports.
    expect(httpSurface).toMatchObject({ kind: "api", bin: "loops-serve", authMode: "api-key" });
    expect(sdkSurface).toMatchObject({
      status: "supported",
      authMode: "api-key",
      exportSubpath: "./sdk",
      generatedFrom: "/openapi.json",
    });
    expect(mcpSurface).toMatchObject({ status: "supported", mcpBin: "loops-mcp" });
    expect(cliSurface).toMatchObject({ status: "supported", bin: "loops" });

    // The split-DSN secret refs are gone from the public manifest (0.10.6
    // public_manifest_safety rejects them); the server still declares its
    // HASNA_LOOPS_*_DATABASE_URL env names in the serve source.
    expect(serviceMetadata.databaseDsnBindings).toBeUndefined();
    expect(serviceMetadata.signingSecretSecretRef).toBeUndefined();
    expect(serveDatabaseEnvNames).toEqual([
      "HASNA_LOOPS_AUTH_DATABASE_URL",
      "HASNA_LOOPS_DATABASE_URL",
      "HASNA_LOOPS_MIGRATOR_DATABASE_URL",
    ]);
  });

  test("health sample converges on the strict {status,version,backend} shape", () => {
    // The runtime /health probe serves the richer foundation envelope
    // { status, version, storage, connection } (asserted in scripts/smoke-serve.ts);
    // the conformance sample must match the strict { status, version, backend }
    // HealthResponseSchema of @hasna/contracts 1.0.2, which rejects extra keys
    // and represents exactly one server backend: postgresql.
    const configured = contractHealthResponse({ HASNA_LOOPS_DATABASE_URL: "postgres://loops.example.test/openloops" });
    expect(configured).toEqual({ status: "ok", version: expect.any(String), backend: "postgresql" });
    expect(configured.storage).toBeUndefined();
    expect(configured.connection).toBeUndefined();
    expect(configured.mode).toBeUndefined();
    // The sqlite development posture is the app's own vocabulary: the sample
    // maps the server backend faithfully, so an unconfigured runtime reports
    // sqlite.
    expect(contractHealthResponse({}).backend).toBe("sqlite");
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
