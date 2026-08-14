import { describe, expect, test } from "bun:test";
import {
  resolveNpmReleasePackageByPath,
  resolveNpmReleasePackageByTag,
  validateNpmReleasePackageBinding,
} from "./npm-release-package";

describe("npm release package routing", () => {
  test("maps root and companion tags to their exact package roots", () => {
    expect(resolveNpmReleasePackageByTag("npm/todos/v0.15.28")).toEqual({
      packagePath: ".",
      manifestPath: "package.json",
      packageName: "@hasna/todos",
      tagPrefix: "npm/todos/v",
      version: "0.15.28",
    });
    expect(resolveNpmReleasePackageByTag("npm/todos-ai/v0.1.1")).toEqual({
      packagePath: "ai",
      manifestPath: "ai/package.json",
      packageName: "@hasna/todos-ai",
      tagPrefix: "npm/todos-ai/v",
      version: "0.1.1",
    });
  });

  test("defaults issuance to root and allows only the two exact package paths", () => {
    expect(resolveNpmReleasePackageByPath(undefined).packagePath).toBe(".");
    expect(resolveNpmReleasePackageByPath(".").packageName).toBe("@hasna/todos");
    expect(resolveNpmReleasePackageByPath("ai").packageName).toBe("@hasna/todos-ai");
    for (const packagePath of ["./ai", "ai/", "packages/ai", "../ai", ""] as const) {
      expect(() => resolveNpmReleasePackageByPath(packagePath)).toThrow("package path must be . or ai");
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
      packagePath: ".",
      packageName: "@hasna/todos-ai",
      packageVersion: "0.1.1",
      tag: "npm/todos-ai/v0.1.1",
    }).map((failure) => failure.check)).toContain("release-package-path");
    expect(validateNpmReleasePackageBinding({
      packagePath: "ai",
      packageName: "@hasna/todos",
      packageVersion: "0.15.28",
      tag: "npm/todos/v0.15.28",
    }).map((failure) => failure.check)).toContain("release-package-path");
  });
});
