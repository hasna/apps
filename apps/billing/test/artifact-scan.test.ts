import { describe, expect, it } from "bun:test";
import packageJson from "../package.json";
import manifest from "../hasna.contract.json";
import { CONTRACTS_KIT_VERSION, scannerCommand } from "../scripts/scan-artifact.js";

describe("packed-artifact release gate", () => {
  it("pins the scanner to the contract dependency and manifest kit version", () => {
    expect(CONTRACTS_KIT_VERSION).toBe(packageJson.devDependencies["@hasna/contracts"]);
    expect(CONTRACTS_KIT_VERSION).toBe(manifest.kitVersion);
    expect(scannerCommand("/tmp/billing.tgz")).toEqual([
      "bunx",
      `@hasna/contracts@${CONTRACTS_KIT_VERSION}`,
      "artifact-scan",
      "/tmp/billing.tgz",
    ]);
  });

  it("is declared in the manifest and reached by prepack", () => {
    expect(manifest.metadata.release.artifactScan.script).toBe("scan:artifact");
    expect(packageJson.scripts["scan:artifact"]).toContain("scripts/scan-artifact.ts");
    expect(packageJson.scripts.prepack).toContain("scan:artifact");
  });
});
