import { describe, expect, test } from "bun:test";
import {
  getInstallSmokeCommands,
  validateNpmView,
  validateInstallSmokeCommands,
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

  test("rejects public docs with npm install, legacy cloud markers, or secret-like values", () => {
    const legacyMarkers = [
      "Cloud" + " sync",
      `@hasna/${"cloud"}`,
      `${"open"}-${"cloud"}`,
      `${"cloud"}-${"mcp"}`,
      `--${"cloud"}`,
      `HASNA_${"CLOUD"}_URL`,
      `register${"Cloud"}Tools`,
      `register${"Cloud"}Commands`,
      `HASNA_${"RDS"}_PASSWORD`,
    ];
    const failures = validatePublicTextSurfaces([
      { path: "README.md", text: `npm install -g @hasna/todos\n${legacyMarkers.join("\n")}\nAWS_ACCESS_KEY_ID="${"AKIA"}1234567890123456"` },
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

  test("keeps the Bun install smoke plan public, local, and stable", () => {
    const plan = getInstallSmokeCommands("/tmp/hasna-todos.tgz", "19717");
    const rendered = plan.map((step) => [step.command, ...step.args].join(" "));

    expect(validateInstallSmokeCommands(plan)).toEqual([]);
    expect(rendered).toContain("bun install -g /tmp/hasna-todos.tgz");
    expect(rendered).toContain("bash -lc command -v todos && command -v todos-mcp && command -v todos-serve");
    expect(rendered).toContain("todos --version");
    expect(rendered).toContain("todos --help");
    expect(rendered).toContain("todos-mcp --help");
    expect(rendered).toContain("todos-serve --port=19717 --host 127.0.0.1 --no-open");
    expect(rendered.some((line) => line.startsWith("npm "))).toBe(false);
    expect(rendered.some((line) => line.includes("platform-todos"))).toBe(false);
  });

  test("rejects install smoke plans that use non-Bun installers or private endpoints", () => {
    const failures = validateInstallSmokeCommands([
      { command: "npm", args: ["install", "-g", "@hasna/todos"] },
      { command: "todos", args: ["--help"] },
      { command: "todos", args: ["--version"] },
      { command: "todos-mcp", args: ["--help"] },
      { command: "bash", args: ["-lc", "command -v todos && command -v todos-mcp && command -v todos-serve"] },
    ]);

    expect(failures.map((failure) => failure.check)).toContain("install-smoke-bun-install");
    expect(failures.map((failure) => failure.check)).toContain("install-smoke-npm");
  });
});
