import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Monorepo release-ceremony regression guard (todos A18-00026/27).
 *
 * These assertions pin the @hasna/secrets npm release ceremony to the
 * post-monorepo-migration facts. They fail loudly if any gate silently
 * regresses again, which is the exact failure the ceremony check measured:
 *
 *   • GitHub Actions only discovers workflows at the repo-root
 *     `.github/workflows/` of the pushed repository, so the release workflow
 *     must live there — a per-app `.github/workflows/` file is an orphan that
 *     never runs.
 *   • npm trusted publishing binds by FILENAME (release.yml) + the
 *     `npm-release` environment + the repository, so the file must keep its
 *     name and the guard must name the living monorepo `hasna/apps` — the
 *     standalone `hasna/secrets` repository is gone (HTTP 404), so a guard
 *     naming it skips every push even after discovery is fixed.
 *   • package-scoped steps (install / typecheck / test / build / publish) must
 *     run inside `apps/secrets`, because the checkout root is the monorepo.
 *
 * Two-sided prearm: every assertion in this file is FALSE against the
 * pre-repair tree (dead repository URL, shadow-located workflow, no root
 * workflow, no `hasna/apps` guard, no working-directory) and TRUE after the
 * repair, so the suite cannot pass vacuously.
 */
const packageRoot = join(import.meta.dir, "..");
const repoRoot = join(packageRoot, "..", "..");
const rootWorkflowPath = join(repoRoot, ".github", "workflows", "release.yml");
const shadowWorkflowPath = join(packageRoot, ".github", "workflows", "release.yml");

function readPackageJson(): { repository?: { url?: string }; version: string } {
  return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
}

function readRootWorkflow(): string {
  return readFileSync(rootWorkflowPath, "utf8");
}

describe("secrets npm release ceremony (monorepo)", () => {
  it("pins the repository identity to the living monorepo, not the 404'd standalone repo", () => {
    const manifest = readPackageJson();
    expect(manifest.repository?.url).toContain("github.com/hasna/apps");
    expect(manifest.repository?.url).not.toContain("hasna/secrets.git");
  });

  it("homes the release workflow where GitHub Actions can discover it", () => {
    expect(existsSync(rootWorkflowPath)).toBe(true);
  });

  it("removes the orphan shadow-location workflow so two copies cannot diverge", () => {
    expect(existsSync(shadowWorkflowPath)).toBe(false);
  });

  it("binds the job guard to hasna/apps so the workflow runs on monorepo pushes", () => {
    expect(readRootWorkflow()).toContain("github.repository == 'hasna/apps'");
  });

  it("keeps the npm trusted-publisher filename, environment, and tag trigger", () => {
    const yaml = readRootWorkflow();
    expect(yaml).toContain("environment: npm-release");
    expect(yaml).toContain('"npm/secrets/v*"');
  });

  it("runs package-scoped steps inside apps/secrets", () => {
    expect(readRootWorkflow()).toContain("working-directory: apps/secrets");
  });
});
