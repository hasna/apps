import { describe, expect, test } from "bun:test";
import { validateServiceContractManifest } from "@hasna/contracts/service-contract";
import contract from "../hasna.contract.json";
import packageJson from "../package.json";
import { KIT_VERSION } from "./generated/storage-kit/index.js";

describe("hasna.contract.json", () => {
  test("is a valid service contract manifest", () => {
    const result: any = validateServiceContractManifest(contract);
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  test("declares the three contract-allowlisted service bins; the two station bins are the recorded exception", () => {
    // The service-contract validator allowlists only the canonical suffixes
    // ("", -cli, -mcp, -serve, -worker, -runner, -daemon, -migrate, -doctor), so
    // `conversations-hook` and `conversations-inbox` cannot be declared here.
    // They stay in package.json for the stations that already wire them
    // (census record bins_match_package, todos ee9fbb4d) until they are folded
    // into `conversations blockers --hook` and relocated.
    expect(contract.bins).toEqual(["conversations", "conversations-mcp", "conversations-serve"]);
    const shipped = Object.keys(packageJson.bin);
    for (const bin of contract.bins) expect(shipped).toContain(bin);
    expect(shipped.filter((bin) => !contract.bins.includes(bin))).toEqual(["conversations-inbox", "conversations-hook"]);
  });

  test("every client surface authenticates with an API key; no local-only surface remains", () => {
    for (const surface of contract.serviceSurfaces) expect(surface.authMode).toBe("api-key");
    expect(contract.storage.engines).toEqual(["postgresql"]);
    expect((contract.storage as Record<string, unknown>).sqlitePath).toBeUndefined();
    expect(contract.description).not.toMatch(/opt-in/);
  });

  test("pins the vendored storage kit version actually on disk", () => {
    expect(contract.kitVersion).toBe(KIT_VERSION);
  });

  test("service metadata exposes the versioned health/ready/version + v1 paths", () => {
    const svc = contract.metadata.service;
    expect(svc.healthPath).toBe("/health");
    expect(svc.readyPath).toBe("/ready");
    expect(svc.versionPath).toBe("/version");
    expect(svc.apiVersion).toBe("v1");
    expect(svc.auth).toBe("api-key");
  });
});
