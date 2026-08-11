import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const releaseWorkflow = readFileSync(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8");
const publicReleaseVerifier = readFileSync(resolve(import.meta.dir, "../scripts/verify-public-release.ts"), "utf8");
const rootPackage = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")) as { version: string };
const companionPackage = JSON.parse(readFileSync(resolve(import.meta.dir, "../ai/package.json"), "utf8")) as {
  version: string;
  scripts: Record<string, string>;
};
const receiptSecretExpression = "${{ secrets.NPM_RELEASE_AGENT_REVIEW_RECEIPT }}";

function syntheticActionsEnvPreamble(expressions: string[], receipt: string): string {
  return expressions
    .map((expression) =>
      `NPM_RELEASE_AGENT_REVIEW_RECEIPT: ${expression === receiptSecretExpression ? "***" : receipt}`,
    )
    .join("\n");
}

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

  test("delivers every review receipt through a masked Actions secret", () => {
    const receiptExpressions = Array.from(
      releaseWorkflow.matchAll(/^\s+NPM_RELEASE_AGENT_REVIEW_RECEIPT:\s*(.+)$/gm),
      (match) => match[1].trim(),
    );

    expect(receiptExpressions).toHaveLength(2);
    expect(releaseWorkflow).not.toContain("vars.NPM_RELEASE_AGENT_REVIEW_RECEIPT");
    expect(receiptExpressions).toEqual([receiptSecretExpression, receiptSecretExpression]);

    const syntheticReceipt = "synthetic.release.review.receipt.fixture";
    const unsafePreamble = syntheticActionsEnvPreamble(
      ["${{ vars.NPM_RELEASE_AGENT_REVIEW_RECEIPT }}"],
      syntheticReceipt,
    );
    expect(unsafePreamble).toContain(syntheticReceipt);
    expect(unsafePreamble).not.toContain("***");

    const preamble = syntheticActionsEnvPreamble(receiptExpressions, syntheticReceipt);
    expect(preamble).not.toContain(syntheticReceipt);
    expect(preamble.match(/NPM_RELEASE_AGENT_REVIEW_RECEIPT: \*\*\*/g)?.length).toBe(2);
  });

  test("routes root and companion tags to only their fixed package directories", () => {
    expect(releaseWorkflow).toContain('- "npm/todos/v*"');
    expect(releaseWorkflow).toContain('- "npm/todos-ai/v*"');
    expect(releaseWorkflow).toContain("scripts/resolve-npm-release-package.ts");
    expect(releaseWorkflow).toContain("working-directory: ${{ steps.version.outputs.path }}");
    expect(releaseWorkflow).toContain("HASNA_TODOS_RELEASE_PACKAGE_PATH: ${{ steps.version.outputs.path }}");
    expect(rootPackage.version).toBe("0.15.29");
    expect(companionPackage.version).toBe("0.1.2");
    expect(companionPackage.scripts["verify:release-review"]).toBe("bun run ../scripts/verify-npm-release-agent-review.ts");
    expect(companionPackage.scripts.prepublishOnly).toBe("bun run verify:release-review");
    expect(releaseWorkflow).not.toMatch(/^\s+NODE_AUTH_TOKEN:/m);
    expect(releaseWorkflow).not.toMatch(/^\s+NPM_TOKEN:/m);
  });

  test("keeps root gates and adds companion install, typecheck, test, build, pack, and release-input gates", () => {
    for (const step of [
      "Install AI companion locked dependencies",
      "Typecheck AI companion",
      "Test AI companion",
      "Build AI companion",
      "Verify AI companion pack",
      "Require a clean AI companion release input",
    ]) {
      expect(releaseWorkflow).toContain(`- name: ${step}`);
    }
    expect(releaseWorkflow).toContain("if: steps.version.outputs.path == '.'");
    expect(releaseWorkflow).toContain("if: steps.version.outputs.path == 'ai'");
    expect(releaseWorkflow).toContain("gitHead");
  });
});
