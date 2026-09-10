import { describe, expect, test } from "bun:test";
import {
  MINIMUM_NPM_VERSION,
  assertTrustedPublishingVersion,
  supportsTrustedPublishing,
} from "./verify-npm-trusted-publishing-version";

const workflow = await Bun.file(
  new URL("../.github/workflows/publish.yml", import.meta.url),
).text();
const packageJson = await Bun.file(
  new URL("../package.json", import.meta.url),
).json() as {
  name: string;
  repository: { type: string; url: string; directory: string };
  publishConfig: { registry: string; access: string };
};

describe("npm trusted publishing workflow", () => {
  test("fails closed below npm 11.5.1", () => {
    expect(MINIMUM_NPM_VERSION).toBe("11.5.1");
    expect(supportsTrustedPublishing("10.9.8")).toBeFalse();
    expect(supportsTrustedPublishing("11.5.0")).toBeFalse();
    expect(supportsTrustedPublishing("11.5.1")).toBeTrue();
    expect(supportsTrustedPublishing("11.5.1-beta.0")).toBeFalse();
    expect(supportsTrustedPublishing("12.0.0")).toBeTrue();
    expect(supportsTrustedPublishing("not-a-version")).toBeFalse();
    expect(() => assertTrustedPublishingVersion("10.9.8")).toThrow(
      "npm 10.9.8 is too old for trusted publishing; requires npm >= 11.5.1.",
    );
  });

  test("checks a supported npm client before install, build, or publish", () => {
    expect(workflow).toContain("uses: actions/setup-node@v6");
    expect(workflow).toMatch(/node-version:\s*24\b/);
    expect(workflow).toContain("- name: Verify npm supports trusted publishing");
    expect(workflow).toContain(
      'bun run scripts/verify-npm-trusted-publishing-version.ts "$(npm --version)"',
    );

    const setupNode = workflow.indexOf("- name: Setup Node");
    const versionGate = workflow.indexOf("- name: Verify npm supports trusted publishing");
    const install = workflow.indexOf("- name: Install dependencies");
    const build = workflow.indexOf("- name: Build");
    const publish = workflow.indexOf("- name: Publish to npm");

    expect(setupNode).toBeGreaterThanOrEqual(0);
    expect(versionGate).toBeGreaterThan(setupNode);
    expect(versionGate).toBeLessThan(install);
    expect(versionGate).toBeLessThan(build);
    expect(versionGate).toBeLessThan(publish);
  });

  test("preserves token-free OIDC provenance and package identity", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).toContain("npm publish --access public --provenance");
    expect(workflow).not.toContain("NPM_TOKEN");
    expect(workflow).not.toContain("NODE_AUTH_TOKEN:");
    expect(workflow).not.toContain("${{ secrets.");

    // ORG LAW (2026-09-10): the pre-monorepo per-app repo is gone; the package
    // lives in hasna/apps at apps/files, so the tuple is the monorepo url with
    // the on-disk directory — no `git+` prefix, no `hasna/files.git`.
    expect(packageJson).toMatchObject({
      name: "@hasna/files",
      repository: {
        type: "git",
        url: "https://github.com/hasna/apps.git",
        directory: "apps/files",
      },
      publishConfig: {
        registry: "https://registry.npmjs.org",
        access: "public",
      },
    });
  });
});
