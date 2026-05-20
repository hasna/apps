import { describe, expect, test } from "bun:test";
import {
  validateNpmView,
  validatePackedPackageFiles,
  validatePackedProvenanceMetadata,
  validatePublicTextSurfaces,
  validateReleaseProvenanceMetadata,
  validateRootPackageMetadata,
  validateSdkPackageMetadata,
  type PackageJson,
} from "./public-release-gate";

const rootPackage: PackageJson = {
  name: "@hasna/todos",
  version: "0.11.41",
  license: "Apache-2.0",
  main: "dist/index.js",
  types: "dist/index.d.ts",
  bin: {
    todos: "dist/cli/index.js",
    "todos-mcp": "dist/mcp/index.js",
    "todos-serve": "dist/server/index.js",
  },
  exports: {
    ".": { import: "./dist/index.js" },
  },
  files: ["dist", "dashboard/dist", "LICENSE", "README.md"],
  workspaces: ["dashboard"],
  publishConfig: { registry: "https://registry.npmjs.org", access: "public" },
  repository: { type: "git", url: "https://github.com/hasna/todos.git" },
  homepage: "https://github.com/hasna/todos",
  bugs: { url: "https://github.com/hasna/todos/issues" },
  dependencies: { chalk: "^5.4.1" },
};

describe("public release gate", () => {
  test("accepts the expected public package metadata", () => {
    expect(validateRootPackageMetadata(rootPackage)).toEqual([]);
    expect(
      validateSdkPackageMetadata({
        name: "@hasna/todos-sdk",
        publishConfig: { access: "public" },
        repository: { type: "git", url: "https://github.com/hasna/todos.git", directory: "sdk" },
        homepage: "https://github.com/hasna/todos",
        bugs: { url: "https://github.com/hasna/todos/issues" },
      }),
    ).toEqual([]);
  });

  test("rejects private package names, hosted bins, and cloud dependencies", () => {
    const failures = validateRootPackageMetadata({
      ...rootPackage,
      name: "@hasnastudio/todos",
      publishConfig: { access: "restricted" },
      bin: { ...rootPackage.bin, "todos-remote": "dist/remote.js" },
      dependencies: { "@aws-sdk/client-s3": "^3.0.0" },
    });

    expect(failures.map((failure) => failure.check)).toContain("package-name");
    expect(failures.map((failure) => failure.check)).toContain("publish-access");
    expect(failures.map((failure) => failure.check)).toContain("bin-remote");
    expect(failures.map((failure) => failure.check)).toContain("dependency-boundary");
  });

  test("rejects public docs with npm install, open-todos, or secret-like values", () => {
    const failures = validatePublicTextSurfaces([
      { path: "README.md", text: `npm install -g @hasna/todos\nAWS_ACCESS_KEY_ID="${"AKIA"}1234567890123456"` },
      { path: "sdk/package.json", text: "https://github.com/hasna/open-todos" },
    ]);

    expect(failures.map((failure) => failure.check)).toContain("public-text-boundary");
    expect(failures.map((failure) => failure.check)).toContain("secret-scan");
    expect(failures.map((failure) => failure.check)).toContain("readme-install");
  });

  test("checks generated npm package contents", () => {
    expect(
      validatePackedPackageFiles([
        "package/package.json",
        "package/README.md",
        "package/LICENSE",
        "package/dist/index.js",
        "package/dist/index.d.ts",
        "package/dist/cli/index.js",
        "package/dist/mcp/index.js",
        "package/dist/server/index.js",
        "package/dist/release-provenance.json",
        "package/dashboard/dist/index.html",
      ]),
    ).toEqual([]);

    const failures = validatePackedPackageFiles(["package/package.json", "package/src/index.ts", "package/.env"]);
    expect(failures.map((failure) => failure.check)).toContain("pack-contents");
    expect(failures.map((failure) => failure.check)).toContain("pack-source");
    expect(failures.map((failure) => failure.check)).toContain("pack-env");
  });

  test("requires packed package provenance and public npm visibility", () => {
    expect(validatePackedProvenanceMetadata(rootPackage)).toEqual([]);
    expect(validateReleaseProvenanceMetadata({
      packageName: "@hasna/todos",
      packageVersion: "0.11.41",
      repository: "https://github.com/hasna/todos.git",
      gitCommit: "0123456789abcdef0123456789abcdef01234567",
      generatedAt: "2026-05-21T00:00:00.000Z",
    }, rootPackage)).toEqual([]);

    expect(validateReleaseProvenanceMetadata({}, rootPackage).map((failure) => failure.check)).toContain("provenance-git-commit");
    expect(validateNpmView("@hasna/todos", JSON.stringify({ name: "@hasna/todos", version: "0.11.40" }))).toEqual([]);
    expect(validateNpmView("@hasna/todos", JSON.stringify({ name: "@scope/other" }))).not.toEqual([]);
  });
});
