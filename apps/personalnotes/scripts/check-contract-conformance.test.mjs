import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadServiceContractManifest,
  validateServiceContractManifest,
} from "@hasna/contracts";
import { repoRoot, runContractConformance } from "./check-contract-conformance.mjs";

const manifestPath = join(repoRoot, "hasna.contract.json");
const manifestText = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

describe("personalnotes contract conformance", () => {
  test("repo conformance passes with no failing checks", () => {
    const report = runContractConformance();
    const failing = report.checks.filter((c) => c.status === "fail");
    expect(failing).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.name).toBe("personalnotes");
    expect(report.class).toBe("service");
  });

  test("manifest validates against the @hasna/contracts service-contract schema", () => {
    const result = validateServiceContractManifest(manifest);
    expect(result.success).toBe(true);
    const loaded = loadServiceContractManifest(repoRoot);
    expect(loaded.ok).toBe(true);
  });

  test("kitVersion tracks the pinned @hasna/contracts devDependency", () => {
    const dep =
      pkg.devDependencies?.["@hasna/contracts"] ??
      pkg.dependencies?.["@hasna/contracts"];
    expect(dep).toBeDefined();
    // exact pin (no range prefix) so kitVersion cannot silently drift
    expect(manifest.kitVersion).toBe(dep.replace(/^[^0-9]*/, ""));
  });

  test("declares the four surfaces (CLI + MCP + HTTP bins, SDK export) per gap-spec", () => {
    expect(manifest.bins).toEqual([
      "personalnotes",
      "personalnotes-mcp",
      "personalnotes-serve",
    ]);
    // package.json bin keys must match the declared bins exactly (bins_match_package)
    expect(Object.keys(pkg.bin)).toEqual(manifest.bins);
    const kinds = (manifest.metadata.surfaces ?? []).map((s) => s.kind).sort();
    expect(kinds).toEqual(["cli", "http", "mcp", "sdk"]);
    const sdk = manifest.metadata.surfaces.find((s) => s.kind === "sdk");
    expect(sdk.exportSubpath).toBe("./sdk");
  });

  test("declares the dual-engine storage capability matrix and both hosting stories", () => {
    expect(manifest.storage.envPrefix).toBe("HASNA_PERSONALNOTES_");
    expect(manifest.storage.sqlitePath.endsWith(".db")).toBe(true);
    expect([...manifest.metadata.storage.engines].sort()).toEqual([
      "postgres",
      "sqlite",
    ]);
    expect([...manifest.metadata.hosting].sort()).toEqual([
      "hasna-saas",
      "user-hosted",
    ]);
    expect(manifest.deploymentModes).toEqual(["local", "self-hosted", "cloud"]);
  });

  test("public manifest leaks no private-tier infra references", () => {
    expect(manifest.storage.databaseUrlSecretRef).toBeUndefined();
    const forbidden = [
      /"databaseUrlSecretRef"/,
      /"databaseDsnBindings"/,
      /hasna\/oss\//,
      /hasna\.xyz/,
      /arn:aws/,
      /\b\d{12}\b/,
    ];
    for (const pattern of forbidden) {
      expect(manifestText).not.toMatch(pattern);
    }
  });

  test("a top-level hosting field is rejected by the strict schema (why it lives in metadata)", () => {
    const mutated = { ...manifest, hosting: ["user-hosted"] };
    expect(validateServiceContractManifest(mutated).success).toBe(false);
  });

  test("a storage.engines field at the storage level is rejected by the strict schema", () => {
    const mutated = {
      ...manifest,
      storage: { ...manifest.storage, engines: ["sqlite", "postgres"] },
    };
    expect(validateServiceContractManifest(mutated).success).toBe(false);
  });
});
