import { describe, expect, test } from "bun:test";
import {
  resolveNpmReleasePackageByPath,
  resolveNpmReleasePackageByTag,
  validateNpmReleasePackageBinding,
} from "./npm-release-package";

describe("npm release package routing", () => {
  test("maps root and companion tags to their exact monorepo package roots", () => {
    expect(resolveNpmReleasePackageByTag("npm/todos/v0.15.28")).toEqual({
      packagePath: "apps/todos",
      manifestPath: "apps/todos/package.json",
      packageName: "@hasna/todos",
      tagPrefix: "npm/todos/v",
      releaseProcedure: "bun run scripts/verify-public-release.ts --mode=publish",
      releaseProcedurePath: "apps/todos/scripts/verify-public-release.ts",
      version: "0.15.28",
    });
    expect(resolveNpmReleasePackageByTag("npm/todos-ai/v0.1.1")).toEqual({
      packagePath: "apps/todos/ai",
      manifestPath: "apps/todos/ai/package.json",
      packageName: "@hasna/todos-ai",
      tagPrefix: "npm/todos-ai/v",
      releaseProcedure: "bun run ../scripts/verify-npm-release-agent-review.ts",
      releaseProcedurePath: "apps/todos/scripts/verify-npm-release-agent-review.ts",
      version: "0.1.1",
    });
  });

  test("defaults issuance to todos and allows only the two exact monorepo package paths", () => {
    expect(resolveNpmReleasePackageByPath(undefined).packagePath).toBe("apps/todos");
    expect(resolveNpmReleasePackageByPath("apps/todos").packageName).toBe("@hasna/todos");
    expect(resolveNpmReleasePackageByPath("apps/todos/ai").packageName).toBe("@hasna/todos-ai");
    for (const packagePath of [".", "ai", "./apps/todos/ai", "apps/todos/ai/", "packages/ai", "../ai", ""] as const) {
      expect(() => resolveNpmReleasePackageByPath(packagePath)).toThrow("package path must be apps/todos or apps/todos/ai");
    }
  });

  test("rejects unknown, empty, and near-prefix release tags", () => {
    for (const tag of [
      "npm/todos/v",
      "npm/todos-ai/v",
      "npm/todos/v0.15.28/extra",
      "npm/todos-ai/v0.1.1/extra",
      "npm/todosai/v0.1.1",
      "npm/other/v0.1.1",
    ]) {
      expect(() => resolveNpmReleasePackageByTag(tag)).toThrow("unrecognised npm release tag");
    }
  });

  test("prevents either release tag from selecting the other package", () => {
    expect(validateNpmReleasePackageBinding({
      packagePath: "apps/todos",
      packageName: "@hasna/todos-ai",
      packageVersion: "0.1.1",
      tag: "npm/todos-ai/v0.1.1",
    }).map((failure) => failure.check)).toContain("release-package-path");
    expect(validateNpmReleasePackageBinding({
      packagePath: "apps/todos/ai",
      packageName: "@hasna/todos",
      packageVersion: "0.15.28",
      tag: "npm/todos/v0.15.28",
    }).map((failure) => failure.check)).toContain("release-package-path");
  });
});
