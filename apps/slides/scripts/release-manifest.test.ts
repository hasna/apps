import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("release hooks scan the actual npm artifact with exact published Contracts", () => {
  const root = join(import.meta.dir, "..");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const contract = JSON.parse(readFileSync(join(root, "hasna.contract.json"), "utf8"));
  expect(manifest.scripts["scan:artifact"]).toBe("bun scripts/scan-artifact.ts");
  expect(manifest.scripts.prepack.endsWith(" && bun run scan:artifact")).toBe(true);
  expect(manifest.devDependencies["@hasna/contracts"]).toBe("0.11.1");
  expect(contract.metadata.release.artifactScan.script).toBe("scan:artifact");
});
