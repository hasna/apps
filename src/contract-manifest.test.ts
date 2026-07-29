import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateServiceContractManifest } from "@hasna/contracts";

const manifest = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "hasna.contract.json"), "utf8"),
) as Record<string, unknown>;

describe("service contract manifest", () => {
  test("uses the @hasna/contracts 0.8.4 storage schema", () => {
    const result = validateServiceContractManifest(manifest);

    expect(result.success).toBe(true);
    expect(manifest.kitVersion).toBe("0.8.4");
    expect((manifest.storage as { mode?: unknown }).mode).toBe("postgres");
  });

  test("rejects legacy deployment modes and storage values", () => {
    expect(validateServiceContractManifest({ ...manifest, deploymentModes: ["local"] }).success).toBe(false);
    expect(
      validateServiceContractManifest({
        ...manifest,
        storage: { ...(manifest.storage as object), mode: "cloud" },
      }).success,
    ).toBe(false);
  });
});
