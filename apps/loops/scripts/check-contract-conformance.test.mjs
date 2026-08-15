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
  vendoredSeamWaiver,
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
  test("passes official bin conformance without a loops-api compatibility waiver", () => {
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
      ok: false,
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
    expect(report.adjudications).toEqual([
      {
        checkId: "credential_seam_compliance",
        taskId: "d295c91e",
        kind: "vendored-seam",
        detail: officialSeamCheck.detail,
      },
    ]);
    expect(
      report.checks.find(({ id }) => id === "health_shape"),
    ).toMatchObject({ status: "pass" });
    // Known, tracked debt: @hasna/contracts 0.10.6's new credential_seam_compliance
    // gate flags loops' vendored client seam (src/lib/cloud/transport.ts,
    // src/lib/cloud/storage.ts define resolveClientTransport /
    // createClientTransport / createHasnaHttpTransport / resolveStorageClient).
    // The loops seam deliberately speaks the doctrine-clean `file | api`
    // vocabulary while @hasna/contracts/client 0.10.6 still speaks
    // `sqlite | http` with disk-tier credential resolution; adopting the shared
    // seam changes client connection semantics and is the tracked cloud/-domain
    // follow-up d295c91e. The waiver is pinned to the exact four-seam detail
    // (see vendoredSeamWaiver), so any OTHER conformance regression — or any
    // change to the seam findings themselves — fails loudly.
    expect(seamCheck).toEqual({
      id: "credential_seam_compliance",
      status: "pass",
      detail:
        "vendored client seam debt adjudicated; follow-up todos d295c91e — " +
        "import from @hasna/contracts/client",
    });
    expect(officialSeamCheck.status).toBe("fail");
    expect(officialSeamCheck.detail).toContain(
      "vendored copy of the @hasna/contracts client seam",
    );
    expect(
      report.checks.filter(({ status }) => status === "fail").map(({ id }) => id),
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

  test("seam waiver fires only on the exact known four-seam detail", () => {
    const realSeam = runContractConformance().official.checks.find(
      ({ id }) => id === "credential_seam_compliance",
    );
    const official = (detail, status = "fail") => ({
      checks: [{ id: "credential_seam_compliance", status, detail }],
    });

    expect(vendoredSeamWaiver(official(realSeam.detail))?.officialCheck).toEqual(
      realSeam,
    );

    const extraSeam = `${realSeam.detail}; src/lib/cloud/transport.ts:400 extraClientSeam is DEFINED here — this is a vendored copy of the @hasna/contracts client seam, not a use of it.`;
    expect(vendoredSeamWaiver(official(extraSeam))).toBeNull();

    const reworded = realSeam.detail.replace(
      "resolveStorageClient",
      "renamedStorageClient",
    );
    expect(vendoredSeamWaiver(official(reworded))).toBeNull();

    expect(vendoredSeamWaiver(official(realSeam.detail, "pass"))).toBeNull();

    expect(
      vendoredSeamWaiver({
        checks: [
          { id: "other_check", status: "fail", detail: realSeam.detail },
        ],
      }),
    ).toBeNull();
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
    // HealthResponseSchema of @hasna/contracts 0.10.6, which rejects extra keys.
    const sample = contractHealthResponse({});
    expect(sample).toEqual({ status: "ok", version: expect.any(String), backend: expect.stringMatching(/^(sqlite|postgresql)$/) });
    expect(sample.storage).toBeUndefined();
    expect(sample.connection).toBeUndefined();
    expect(sample.mode).toBeUndefined();
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
