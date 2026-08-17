import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const ciWorkflow = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
const releasePackageResolver = readFileSync(resolve(import.meta.dir, "../scripts/resolve-npm-release-package.ts"), "utf8");
const releaseReviewGuide = readFileSync(resolve(import.meta.dir, "../docs/npm-release-agent-review.md"), "utf8");
const publicReleaseVerifier = readFileSync(resolve(import.meta.dir, "../scripts/verify-public-release.ts"), "utf8");
const rootPackage = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")) as {
  version: string;
  scripts: Record<string, string>;
};
const companionPackage = JSON.parse(readFileSync(resolve(import.meta.dir, "../ai/package.json"), "utf8")) as {
  version: string;
  scripts: Record<string, string>;
};
describe("npm release procedure", () => {
  test("uses each package's strict prepublish hook as the signed procedure", () => {
    expect(rootPackage.scripts.prepublishOnly).toBe("bun run scripts/verify-public-release.ts --mode=publish");
    expect(companionPackage.scripts["verify:release-review"]).toBe("bun run ../scripts/verify-npm-release-agent-review.ts");
    expect(companionPackage.scripts.prepublishOnly).toBe("bun run ../scripts/verify-npm-release-agent-review.ts");
    expect(publicReleaseVerifier).toContain('runOrExit("bun", ["run", "scripts/verify-npm-release-agent-review.ts"])');
  });

  test("changing the AI review alias cannot bypass its direct prepublish verifier", () => {
    const directProcedure = "bun run ../scripts/verify-npm-release-agent-review.ts";
    const aliasChanged = {
      ...companionPackage,
      scripts: { ...companionPackage.scripts, "verify:release-review": "echo bypass" },
    };

    expect(aliasChanged.scripts.prepublishOnly).toBe(directProcedure);
    expect(aliasChanged.scripts.prepublishOnly).not.toBe("bun run verify:release-review");

    const aliasedPrepublish = {
      ...companionPackage,
      scripts: { ...companionPackage.scripts, prepublishOnly: "bun run verify:release-review" },
    };
    expect(aliasedPrepublish.scripts.prepublishOnly).not.toBe(directProcedure);
  });

  test("does not misrepresent monorepo CI as an npm publish workflow", () => {
    expect(ciWorkflow).toContain("pull_request:");
    expect(ciWorkflow).toContain("branches: [main]");
    expect(ciWorkflow).not.toContain("npm publish");
    expect(ciWorkflow).not.toContain("npm/todos/v*");
    expect(ciWorkflow).not.toContain("npm/todos-ai/v*");
  });

  test("does not retain an unreachable package-local Actions release workflow", () => {
    expect(() => readFileSync(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8")).toThrow();
  });

  test("keeps manual release resolution and reviewer instructions on the monorepo contract", () => {
    expect(releasePackageResolver).toContain('resolveNpmReleasePackageByPath("apps/todos")');
    expect(releaseReviewGuide).toContain("hasna.npm-release-agent-review.v2");
    expect(releaseReviewGuide).toContain('"repository": "hasna/apps"');
    expect(releaseReviewGuide).toContain('"path": "apps/todos/scripts/verify-public-release.ts"');
    expect(releaseReviewGuide).toContain("--repo hasna/apps --env npm-release");
    expect(releaseReviewGuide).toContain("--package-path <apps-todos-or-apps-todos-ai>");
    expect(releaseReviewGuide).not.toContain(".github/workflows/release.yml");
    expect(releaseReviewGuide).not.toContain("hasna.npm-release-agent-review.v1");
  });
});
