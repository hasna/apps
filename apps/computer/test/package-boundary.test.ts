import { describe, expect, test } from "bun:test";
import packageJson from "../package.json" assert { type: "json" };
import tsconfig from "../tsconfig.json" assert { type: "json" };
import { readFileSync } from "node:fs";

describe("package boundary", () => {
  test("does not hard-require browser, fleet, or Todo packages", () => {
    const dependencyNames = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys((packageJson as any).peerDependencies ?? {}),
      ...Object.keys((packageJson as any).optionalDependencies ?? {}),
    ]);

    expect(dependencyNames.has("@hasna/browser")).toBe(false);
    expect(dependencyNames.has("@hasna/machines")).toBe(false);
    expect(dependencyNames.has("@hasna/todos")).toBe(false);
  });

  test("declares stable package exports and bins", () => {
    expect(Object.keys(packageJson.exports)).toEqual([".", "./storage"]);
    expect(packageJson.bin).toEqual({
      computer: "dist/cli/index.js",
      "computer-mcp": "dist/mcp/index.js",
      "computer-serve": "dist/server/index.js",
    });
  });

  test("package file allowlist includes release assets and excludes private state", () => {
    expect(packageJson.files).toContain("dist");
    expect(packageJson.files).toContain("dashboard/dist");
    expect(packageJson.files).toContain("src/db/migrations");
    expect(packageJson.files).toContain("helpers/scroll");
    expect(packageJson.files).toContain("helpers/accessibility");
    expect(packageJson.files).toContain("helpers/record");
    expect(packageJson.files).toContain("helpers/manifest.json");
    expect(packageJson.files).toContain("docs");
    expect(packageJson.files).toContain("examples");
    expect(packageJson.files).toContain("CHANGELOG.md");
    expect(packageJson.files).not.toContain(".hasna");
    expect(packageJson.files).not.toContain("test");
  });

  test("release publish hooks run the enforceable verification chain", () => {
    expect(packageJson.scripts["test"]).toBe("bun test --path-ignore-patterns='dashboard/tests/**'");
    expect(packageJson.scripts["verify:release"]).toBe("bun run typecheck && bun run test && bun run build && bun run scripts/verify-release.ts");
    expect(packageJson.scripts["verify:packed-cross-repo"]).toBe("bun run scripts/verify-packed-cross-repo.ts");
    expect(packageJson.scripts["prepublishOnly"]).toBe("bun run verify:workspace:release && bun run verify:release");
  });

  test("does not emit package declaration maps as source-path residue", () => {
    expect(tsconfig.compilerOptions.declarationMap).toBe(false);
    expect(tsconfig.compilerOptions.sourceMap).toBe(false);
  });

  test("release verifier scans packed contents for leak and bloat classes", () => {
    const verifier = readFileSync("scripts/verify-release.ts", "utf8");
    expect(verifier).toContain("MAX_UNEXPECTED_FILE_BYTES");
    expect(verifier).toContain("assertNoPackedSecretText");
    expect(verifier).toContain("assertDashboardAssetsAreReferenced");
    expect(verifier).toContain("assertPackageAllowedFileSet");
    expect(verifier).toContain("assertHelperManifest");
    expect(verifier).toContain("smokeInstalledDashboard");
    expect(verifier).toContain("assertPackMetadataMatchesTarball");
    expect(verifier).toContain("SECRET_TEXT_PATTERNS");
  });

  test("cross-repo packed verifier uses local bins instead of global package CLIs", () => {
    const verifier = readFileSync("scripts/verify-packed-cross-repo.ts", "utf8");
    expect(verifier).toContain("open-computer.packed-cross-repo-smoke.v1");
    expect(verifier).toContain("npm\", \"install\", \"--omit=dev\", \"--ignore-scripts\"");
    expect(verifier).toContain("binPath(appDir");
    expect(verifier).toContain("assertLocalBin");
    expect(verifier).not.toContain("npx ");
    expect(verifier).not.toContain("bunx ");
  });

  test("safe action sampler stays source-checkout only and avoids package dependency creep", () => {
    const sampler = readFileSync("scripts/run-safe-action-sampler.ts", "utf8");
    expect(packageJson.scripts["run:safe-action-sampler"]).toBe("bun run scripts/run-safe-action-sampler.ts");
    expect(packageJson.files).not.toContain("scripts");
    expect(sampler).toContain("open-computer.safe-action-sampler.v1");
    expect(sampler).toContain("fixture_only: true");
    expect(sampler).toContain("external_sites: false");
    expect(sampler).toContain("secrets_touched: false");
    expect(sampler).toContain("destructive_actions: false");
    expect(sampler).toContain("acquireRuntimeLease");
    expect(sampler).toContain("visual_checks");
    expect(sampler).toContain("pixel_difference_ratio");
    expect(sampler).toContain("../../open-browser/node_modules/playwright/index.js");
  });

  test("compatibility matrix records exact cross-repo pins and drift decisions", () => {
    const compatibility = readFileSync("docs/compatibility.md", "utf8");
    for (const required of [
      "## Exact Compatibility Pins",
      "`@hasna/computer` | Local tarball `0.1.13`",
      "`@hasna/browser` | Local tarball `0.4.19`",
      "`@hasna/machines` | Local tarball `0.0.46`",
      "`@hasna/todos` | Local tarball `0.11.56`",
      "Playwright browser engine",
      "Chromium used for dashboard evidence",
      "Browser declares exact `@hasna/todos` `0.11.53`",
      "Do not hide this with npm overrides",
      "Bun `1.3.14`",
    ]) {
      expect(compatibility).toContain(required);
    }
  });
});
