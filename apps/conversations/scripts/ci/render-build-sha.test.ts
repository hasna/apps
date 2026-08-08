import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderBuildShaModule } from "./render-build-sha.js";

const sourceSha = "a".repeat(40);
const differentSourceSha = "b".repeat(40);
const roots: string[] = [];

afterEach(() => {
  delete process.env.BUILD_SHA;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("build-time SHA module", () => {
  test("renders each full source SHA into a distinct artifact module", () => {
    const first = renderBuildShaModule(sourceSha);
    const second = renderBuildShaModule(differentSourceSha);

    expect(first).toContain(sourceSha);
    expect(first).not.toContain(differentSourceSha);
    expect(second).toContain(differentSourceSha);
    expect(second).not.toContain(sourceSha);
  });

  test("the baked module ignores a conflicting runtime environment value", async () => {
    const root = mkdtempSync(join(tmpdir(), "conversations-build-sha-"));
    roots.push(root);
    const modulePath = join(root, "build-sha.generated.ts");
    writeFileSync(modulePath, renderBuildShaModule(sourceSha));
    process.env.BUILD_SHA = differentSourceSha;

    const artifact = await import(`${pathToFileURL(modulePath).href}?artifact=${sourceSha}`);
    expect(artifact.BAKED_BUILD_SHA).toBe(sourceSha);
    expect(artifact.BAKED_BUILD_SHA).not.toBe(process.env.BUILD_SHA);
  });

  test("keeps generic local images buildable without claiming a source SHA", () => {
    const localArtifact = renderBuildShaModule("", false);

    expect(localArtifact).toContain("export const BAKED_BUILD_SHA: string | null = null;");
    expect(localArtifact).not.toContain(sourceSha);
    expect(() => renderBuildShaModule("", true)).toThrow("BUILD_SHA is required");
  });

  test("rejects values that are not full lowercase Git SHAs", () => {
    for (const invalid of ["development", sourceSha.slice(0, 39), sourceSha.toUpperCase()]) {
      expect(() => renderBuildShaModule(invalid)).toThrow("full 40-character lowercase Git SHA");
    }
  });
});
