import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const releaseWorkflow = readFileSync(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8");
const publicReleaseVerifier = readFileSync(resolve(import.meta.dir, "../scripts/verify-public-release.ts"), "utf8");

describe("npm release workflow", () => {
  test("binds strict prepublish verification to the checked-out Actions commit", () => {
    expect(releaseWorkflow).toContain("HASNA_TODOS_EXPECTED_COMMIT: ${{ github.sha }}");
  });

  test("requires an exact independent-agent GO before OIDC publish", () => {
    const reviewStep = releaseWorkflow.indexOf("- name: Require independent agent release review");
    const publishStep = releaseWorkflow.indexOf("- name: Publish to npm via OIDC trusted publishing");

    expect(reviewStep).toBeGreaterThan(-1);
    expect(publishStep).toBeGreaterThan(reviewStep);
    expect(releaseWorkflow.slice(reviewStep, publishStep)).toContain("run: bun run verify:release-review");
    expect(releaseWorkflow.match(/NPM_RELEASE_AGENT_REVIEW_RECEIPT: \$\{\{ vars\.NPM_RELEASE_AGENT_REVIEW_RECEIPT \}\}/g)?.length).toBe(2);
    expect(releaseWorkflow.match(/RELEASE_REVIEWER_AGENT: \$\{\{ vars\.RELEASE_REVIEWER_AGENT \}\}/g)?.length).toBe(2);
    expect(releaseWorkflow.match(/RELEASE_REVIEW_KEY_ID: \$\{\{ vars\.RELEASE_REVIEW_KEY_ID \}\}/g)?.length).toBe(2);
    expect(releaseWorkflow.match(/RELEASE_REVIEW_PUBLIC_KEY: \$\{\{ vars\.RELEASE_REVIEW_PUBLIC_KEY \}\}/g)?.length).toBe(2);
    expect(releaseWorkflow).toContain("environment: npm-release");
    expect(releaseWorkflow).toContain("id-token: write");
    expect(releaseWorkflow).toContain("npm publish --provenance --access public");
    expect(releaseWorkflow).toContain("git merge-base --is-ancestor");
    expect(releaseWorkflow).toContain("bun run test:no-cloud");
    expect(releaseWorkflow).toContain("run: bun test");
    expect(releaseWorkflow).toContain("run: bun run build");
    expect(publicReleaseVerifier).toContain('runOrExit("bun", ["run", "scripts/verify-npm-release-agent-review.ts"])');
  });
});
