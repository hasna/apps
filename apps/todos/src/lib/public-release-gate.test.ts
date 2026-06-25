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
  scripts: {
    "verify:release": "bun run typecheck && bun test && bun run test:no-cloud && bun run scripts/verify-public-release.ts",
    prepublishOnly: "bun run verify:release",
  },
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
        scripts: {
          "verify:release": "bun run typecheck && bun run test && bun run build && npm pack --dry-run && bun run scripts/verify-release.ts",
          prepublishOnly: "bun run verify:release",
        },
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

  test("rejects package metadata without publish release hooks", () => {
    const rootFailures = validateRootPackageMetadata({
      ...rootPackage,
      scripts: { prepublishOnly: "bun run build", "verify:release": "bun run scripts/verify-public-release.ts" },
    });
    const echoRootFailures = validateRootPackageMetadata({
      ...rootPackage,
      scripts: {
        prepublishOnly: "echo verify:release",
        "verify:release": "echo typecheck && echo bun test && echo test:no-cloud && echo scripts/verify-public-release.ts",
      },
    });
    const shortCircuitRootFailures = validateRootPackageMetadata({
      ...rootPackage,
      scripts: {
        prepublishOnly: "bun run verify:release",
        "verify:release": "exit 0 && bun run typecheck && bun test && bun run test:no-cloud && bun run scripts/verify-public-release.ts",
      },
    });
    const sdkFailures = validateSdkPackageMetadata({
      name: "@hasna/todos-sdk",
      publishConfig: { access: "public" },
      repository: { type: "git", url: "https://github.com/hasna/todos.git", directory: "sdk" },
      homepage: "https://github.com/hasna/todos",
      bugs: { url: "https://github.com/hasna/todos/issues" },
      scripts: { build: "bun build src/index.ts --outdir dist --target bun" },
    });
    const echoSdkFailures = validateSdkPackageMetadata({
      name: "@hasna/todos-sdk",
      publishConfig: { access: "public" },
      repository: { type: "git", url: "https://github.com/hasna/todos.git", directory: "sdk" },
      homepage: "https://github.com/hasna/todos",
      bugs: { url: "https://github.com/hasna/todos/issues" },
      scripts: {
        prepublishOnly: "echo verify:release",
        "verify:release": "echo typecheck test build npm pack --dry-run scripts/verify-release.ts",
      },
    });

    expect(rootFailures.map((failure) => failure.check)).toContain("release-script");
    expect(echoRootFailures.map((failure) => failure.check)).toContain("release-script");
    expect(shortCircuitRootFailures.map((failure) => failure.check)).toContain("release-script");
    expect(sdkFailures.map((failure) => failure.check)).toContain("sdk-script");
    expect(echoSdkFailures.map((failure) => failure.check)).toContain("sdk-script");
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
        "package/dist/lib/secret-redaction.d.ts",
        "package/dist/mcp/token-utils.d.ts",
      ], { unpackedSize: 1024 }),
    ).toEqual([]);

    const failures = validatePackedPackageFiles([
      "package/package.json",
      "package/src/index.ts",
      "package/.env",
      "package/.npmrc",
      "package/dist/index.d.ts.map",
      "package/dist/index.test.d.ts",
      "package/dist/private.key",
      "package/dist/token-cache.json",
      "package/dist/testing/data.json",
    ], { unpackedSize: 20 * 1024 * 1024 });
    expect(failures.map((failure) => failure.check)).toContain("pack-contents");
    expect(failures.map((failure) => failure.check)).toContain("pack-source");
    expect(failures.map((failure) => failure.check)).toContain("pack-env");
    expect(failures.map((failure) => failure.check)).toContain("pack-npmrc");
    expect(failures.map((failure) => failure.check)).toContain("pack-map");
    expect(failures.map((failure) => failure.check)).toContain("pack-test");
    expect(failures.map((failure) => failure.check)).toContain("pack-key-material");
    expect(failures.map((failure) => failure.check)).toContain("pack-credential-path");
    expect(failures.map((failure) => failure.check)).toContain("pack-fixture-dir");
    expect(failures.map((failure) => failure.check)).toContain("pack-unpacked-size");
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

  test("keeps the install smoke plan packed, local, and stable", () => {
    const plan = getInstallSmokeCommands("/tmp/hasna-todos.tgz", "19717");
    const rendered = plan.map((step) => [step.command, ...step.args].join(" "));

    expect(validateInstallSmokeCommands(plan)).toEqual([]);
    expect(rendered).toContain("npm install --omit=dev --ignore-scripts /tmp/hasna-todos.tgz");
    expect(rendered).toContain("bash -lc test -x ./node_modules/.bin/todos && test -x ./node_modules/.bin/todos-mcp && test -x ./node_modules/.bin/todos-serve");
    expect(rendered).toContain("./node_modules/.bin/todos --version");
    expect(rendered).toContain("./node_modules/.bin/todos --help");
    expect(rendered).toContain("./node_modules/.bin/todos-mcp --help");
    expect(rendered).toContain("./node_modules/.bin/todos-serve --port=19717 --host 127.0.0.1 --no-open");
    expect(rendered.some((line) => line.includes(" -g"))).toBe(false);
    expect(rendered.some((line) => line.includes("platform-todos"))).toBe(false);
  });

  test("rejects install smoke plans that use non-Bun installers or private endpoints", () => {
    const failures = validateInstallSmokeCommands([
      { command: "npm", args: ["install", "--omit=dev", "--ignore-scripts", "--global", "@hasna/todos"] },
      { command: "./node_modules/.bin/todos", args: ["--help"] },
      { command: "./node_modules/.bin/todos", args: ["--version"] },
      { command: "./node_modules/.bin/todos-mcp", args: ["--help"] },
      { command: "bash", args: ["-lc", "test -x ./node_modules/.bin/todos && test -x ./node_modules/.bin/todos-mcp && test -x ./node_modules/.bin/todos-serve"] },
    ]);
    const echoFailures = validateInstallSmokeCommands([
      { command: "npm", args: ["install", "--omit=dev", "--ignore-scripts", "/tmp/hasna-todos.tgz"] },
      {
        command: "bash",
        args: ["-lc", [
          "echo test -x ./node_modules/.bin/todos",
          "echo test -x ./node_modules/.bin/todos-mcp",
          "echo test -x ./node_modules/.bin/todos-serve",
          "echo ./node_modules/.bin/todos --version",
          "echo ./node_modules/.bin/todos --help",
          "echo ./node_modules/.bin/todos-mcp --help",
          "echo ./node_modules/.bin/todos-serve --port=19717",
        ].join(" && ")],
      },
    ]);
    const missingServeFailures = validateInstallSmokeCommands(getInstallSmokeCommands("/tmp/hasna-todos.tgz", "19717").filter((step) => !step.command.endsWith("todos-serve")));

    expect(failures.map((failure) => failure.check)).toContain("install-smoke-temp-install");
    expect(failures.map((failure) => failure.check)).toContain("install-smoke-global");
    expect(echoFailures.map((failure) => failure.check)).toContain("install-smoke-command");
    expect(missingServeFailures.map((failure) => failure.check)).toContain("install-smoke-command");
  });
});
