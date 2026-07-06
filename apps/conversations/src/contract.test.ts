import { describe, expect, test } from "bun:test";
import { validateServiceContractManifest } from "@hasna/contracts/service-contract";
import contract from "../hasna.contract.json";

describe("hasna.contract.json", () => {
  test("is a valid service contract manifest", () => {
    const result: any = validateServiceContractManifest(contract);
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  test("declares the three service bins", () => {
    expect(contract.bins).toEqual(["conversations", "conversations-mcp", "conversations-serve"]);
  });

  test("pins the vendored storage kit version", () => {
    expect(contract.kitVersion).toBe("0.4.1");
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
