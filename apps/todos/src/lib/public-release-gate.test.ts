import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { scanExtractedPackedFiles } from "./release-packed-scan";
import {
  classifyReleaseGateAuthority,
  derivePackedPackageTargets,
  getNpmPackArgs,
  getInstallSmokeCommands,
  isPackedTextContent,
  resolveReleaseProvenanceTimestamp,
  validateNpmView,
  validateBunReleaseToolchain,
  validateInstallSmokeCommands,
  validatePackedPackageFiles,
  validatePackedProvenanceMetadata,
  validatePublicTextSurfaces,
  validateReleaseArtifactIntegrity,
  validateExpectedReleaseCommit,
  validateReleaseGateArguments,
  validatePackedBinaryFile,
  validateReleaseIndexFlags,
  validateReproducibleArtifactIntegrity,
  validateTrackedWorktreeProof,
  validatePackLifecycleScripts,
  isPublicReleaseTextSurface,
  validateReleaseProvenanceMetadata,
  validateReleaseRepositoryState,
  validateRootPackageMetadata,
  validateSdkPackageMetadata,
  type PackageJson,
} from "./public-release-gate";

const releaseArtifactTest = process.env.HASNA_TODOS_RELEASE_ARTIFACT_TEST === "1" ? test : test.skip;

function runReleaseArtifactCommand(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? "signal"}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

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
  packageManager: "bun@1.3.14",
  scripts: {
    "verify:release": "bun run scripts/verify-public-release.ts --mode=review",
    prepublishOnly: "bun run scripts/verify-public-release.ts --mode=publish",
  },
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

  test("scopes source scanning to public surfaces while packed text stays authoritative", () => {
    expect(isPublicReleaseTextSurface("buildspec.container-candidate.yml")).toBe(false);
    expect(isPublicReleaseTextSurface("scripts/verify-public-release.ts")).toBe(false);
    expect(isPublicReleaseTextSurface("src/cli/index.tsx")).toBe(false);
    expect(isPublicReleaseTextSurface("README.md")).toBe(true);
    expect(isPublicReleaseTextSurface("docs/native-storage.md")).toBe(true);
    expect(isPublicReleaseTextSurface("sdk/package.json")).toBe(true);

    const publishedFailures = validatePublicTextSurfaces([
      { path: "README.md", text: "bun install -g @hasna/todos\nAWS_REGION" },
    ]);
    expect(publishedFailures.map((failure) => failure.check)).toContain("public-text-boundary");
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

  test("derives every packed entrypoint recursively from main, types, bin, and exports", () => {
    const packageJson: PackageJson = {
      ...rootPackage,
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./sdk": {
          types: "./dist/sdk/index.d.ts",
          import: { bun: "./dist/sdk/index.js", default: ["./dist/sdk/index.js"] },
        },
      },
    };
    const paths = [
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
    ];
    const failures = validatePackedPackageFiles(paths, packageJson);
    expect(failures.map((failure) => failure.message)).toContain("packed package must include package/dist/sdk/index.d.ts");
    expect(failures.map((failure) => failure.message)).toContain("packed package must include package/dist/sdk/index.js");
    expect(validatePackedPackageFiles([
      ...paths,
      "package/dist/sdk/index.d.ts",
      "package/dist/sdk/index.js",
    ], packageJson)).toEqual([]);
  });

  test("derives the exact fifteen published metadata targets and requires every files entry to contribute", () => {
    const packageJson: PackageJson = JSON.parse(JSON.stringify({
      ...rootPackage,
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./sdk": { types: "./dist/sdk/index.d.ts", import: "./dist/sdk/index.js" },
        "./mcp": { types: "./dist/mcp.d.ts", import: "./dist/mcp.js" },
        "./registry": { types: "./dist/registry.d.ts", import: "./dist/registry.js" },
        "./contracts": { types: "./dist/contracts.d.ts", import: "./dist/contracts.js" },
        "./storage": { types: "./dist/storage.d.ts", import: "./dist/storage.js" },
      },
    })) as PackageJson;
    const expected = [
      "package/dist/cli/index.js",
      "package/dist/contracts.d.ts", "package/dist/contracts.js",
      "package/dist/index.d.ts", "package/dist/index.js",
      "package/dist/mcp.d.ts", "package/dist/mcp.js", "package/dist/mcp/index.js",
      "package/dist/registry.d.ts", "package/dist/registry.js",
      "package/dist/sdk/index.d.ts", "package/dist/sdk/index.js",
      "package/dist/server/index.js",
      "package/dist/storage.d.ts", "package/dist/storage.js",
    ];
    expect(derivePackedPackageTargets(packageJson)).toEqual(expected);
    const packed = [
      "package/package.json", "package/README.md", "package/LICENSE", "package/dist/release-provenance.json",
      "package/dashboard/dist/index.html", ...expected,
    ];
    expect(validatePackedPackageFiles(packed, packageJson)).toEqual([]);
    expect(validatePackedPackageFiles(packed, { ...packageJson, files: [...packageJson.files!, "vendor"] })
      .map((failure) => failure.check)).toContain("package-files-empty");
  });

  test("requires packed package provenance and public npm visibility", () => {
    expect(validatePackedProvenanceMetadata(rootPackage, rootPackage)).toEqual([]);
    expect(validateReleaseProvenanceMetadata({
      packageName: "@hasna/todos",
      packageVersion: "0.11.41",
      repository: "https://github.com/hasna/todos.git",
      gitCommit: "0123456789abcdef0123456789abcdef01234567",
      gitTree: "89abcdef0123456789abcdef0123456789abcdef",
      sourceTreeSha256: "a".repeat(64),
      generatedAt: "2026-05-21T00:00:00.000Z",
    }, rootPackage, {
      gitCommit: "0123456789abcdef0123456789abcdef01234567",
      gitTree: "89abcdef0123456789abcdef0123456789abcdef",
      sourceTreeSha256: "a".repeat(64),
    })).toEqual([]);

    expect(validateReleaseProvenanceMetadata({}, rootPackage).map((failure) => failure.check)).toContain("provenance-git-commit");
    expect(validatePackedProvenanceMetadata({ ...rootPackage, version: "0.11.40" }, rootPackage).map((failure) => failure.check)).toContain("packed-version");
    expect(validateNpmView("@hasna/todos", JSON.stringify({ name: "@hasna/todos", version: "0.11.40" }))).toEqual([]);
    expect(validateNpmView("@hasna/todos", JSON.stringify({ name: "@scope/other" }))).not.toEqual([]);
  });

  test("rejects dirty release inputs and mismatched artifact integrity", () => {
    expect(validateReleaseRepositoryState("")).toEqual([]);
    expect(validateReleaseRepositoryState(" M package.json\n?? untracked.txt\n").map((failure) => failure.check)).toEqual([
      "release-worktree-dirty",
    ]);
    expect(validateReleaseArtifactIntegrity("sha512-YWJj", "sha512-YWJj")).toEqual([]);
    expect(validateReleaseArtifactIntegrity("sha512-YWJj", "sha512-ZGVm").map((failure) => failure.check)).toEqual([
      "tarball-integrity",
    ]);
    expect(validateReleaseArtifactIntegrity(undefined, "sha512-YWJj").map((failure) => failure.check)).toEqual([
      "tarball-integrity-reported",
    ]);
  });

  test("does not allow release verification to reuse stale build output", () => {
    expect(validateReleaseGateArguments([]).map((failure) => failure.check)).toContain("release-mode");
    expect(validateReleaseGateArguments(["--mode=review", "--skip-build"]).map((failure) => failure.check)).toEqual([
      "release-build-required",
    ]);
  });

  test("review mode is always non-authoritative and publish authority accepts expected commit only from the environment", () => {
    expect(classifyReleaseGateAuthority(["--mode=review"], "a".repeat(40), "ci")).toEqual({
      mode: "review",
      authoritative: false,
      expectedCommit: undefined,
      skipped: [],
    });
    expect(classifyReleaseGateAuthority(["--mode=publish"], "a".repeat(40), "prepublishOnly")).toEqual({
      mode: "publish",
      authoritative: true,
      expectedCommit: "a".repeat(40),
      skipped: [],
    });
    expect(classifyReleaseGateAuthority(
      ["--mode=publish", `--expected-commit=${"a".repeat(40)}`],
      "a".repeat(40),
      "prepublishOnly",
    ).authoritative).toBe(false);
    expect(validateReleaseGateArguments(
      ["--mode=publish", "--skip-install-smoke"],
      { expectedCommit: "a".repeat(40), lifecycleEvent: "prepublishOnly" },
    ).map((failure) => failure.check)).toContain("release-prepublish-skip");
    expect(validateReleaseGateArguments(
      ["--mode=review", "--expected-commit", "a".repeat(40)],
      { expectedCommit: "a".repeat(40), lifecycleEvent: "ci" },
    ).map((failure) => failure.check)).toContain("release-expected-commit-argument");
    expect(validateReleaseGateArguments(
      ["--mode=publish"],
      { expectedCommit: "a".repeat(40), lifecycleEvent: "ci" },
    ).map((failure) => failure.check)).toContain("release-publish-lifecycle");
    expect(validateExpectedReleaseCommit("a".repeat(40), "b".repeat(40)).map((failure) => failure.check))
      .toEqual(["release-expected-commit-match"]);
  });

  test("rejects skip-worktree and assume-unchanged index flags", () => {
    const failures = validateReleaseIndexFlags("S skip-worktree.ts\nh assume-unchanged.ts\nH ordinary.ts\n");
    expect(failures.map((failure) => failure.check)).toEqual([
      "release-index-skip-worktree",
      "release-index-assume-unchanged",
    ]);
  });

  test("detects packed text by content and permits only signature-verified binary paths", () => {
    expect(isPackedTextContent(Buffer.from("Apache License\nAWS_PRIVATE_MARKER\n"))).toBe(true);
    expect(isPackedTextContent(Buffer.from("{\"version\":3}\n"))).toBe(true);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0xff, 0xd9]);
    expect(isPackedTextContent(jpeg)).toBe(false);
    expect(validatePackedBinaryFile("package/dashboard/dist/logo.jpg", jpeg, jpeg)).toEqual([]);
    expect(validatePackedBinaryFile("package/dashboard/dist/logo.jpg", jpeg, Buffer.from([...jpeg, 0]))
      .map((failure) => failure.check)).toContain("pack-binary-source-match");
    expect(validatePackedBinaryFile("package/dashboard/dist/logo.jpg", Buffer.from("not a jpeg"), jpeg)).not.toEqual([]);
    expect(validatePackedBinaryFile("package/dist/native.node", Buffer.from([0x7f, 0x45, 0x4c, 0x46]), jpeg)).not.toEqual([]);
  });

  test("scans multi-megabyte extracted package entries without subprocess truncation", () => {
    const root = mkdtempSync(join(tmpdir(), "todos-packed-scan-"));
    try {
      const entry = join(root, "package", "dist", "cli", "index.js");
      mkdirSync(join(root, "package", "dist", "cli"), { recursive: true });
      writeFileSync(entry, `${"x".repeat(2 * 1024 * 1024)}\nAWS_PRIVATE_MARKER\n`);
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0xff, 0xd9]);
      const failures = scanExtractedPackedFiles([{ path: "dist/cli/index.js" }], root, jpeg);
      expect(failures.map((failure) => failure.check)).toContain("public-text-boundary");
      expect(failures.map((failure) => failure.check)).not.toContain("pack-read");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  releaseArtifactTest("keeps contracts external in the packed payload and resolves it after isolated install", () => {
    expect(Bun.version).toBe("1.3.14");
    const root = resolve(import.meta.dir, "../..");
    const temp = mkdtempSync(join(tmpdir(), "todos-release-artifact-"));
    try {
      runReleaseArtifactCommand(process.execPath, ["run", "build"], root, {
        ...process.env,
        NODE_ENV: "production",
      });
      const packDir = join(temp, "pack");
      const payloadDir = join(temp, "payload");
      const installDir = join(temp, "install");
      mkdirSync(packDir, { recursive: true });
      mkdirSync(payloadDir, { recursive: true });
      mkdirSync(installDir, { recursive: true });

      const packed = JSON.parse(runReleaseArtifactCommand(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir],
        root,
      )) as Array<{ filename: string; files: Array<{ path: string }> }>;
      const artifact = packed[0];
      expect(artifact?.filename).toBeTruthy();
      const tarball = join(packDir, artifact!.filename);
      runReleaseArtifactCommand("tar", ["-xf", tarball, "-C", payloadDir], root);

      const packageJson = JSON.parse(readFileSync(join(payloadDir, "package", "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        version?: string;
      };
      expect(packageJson.dependencies?.["@hasna/contracts"]).toBeTruthy();
      expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
      const scanFailures = scanExtractedPackedFiles(
        artifact!.files,
        payloadDir,
        readFileSync(join(root, "dashboard", "public", "logo.jpg")),
      );
      expect(scanFailures).toEqual([]);

      writeFileSync(join(installDir, "package.json"), `${JSON.stringify({ private: true })}\n`);
      const isolatedEnv = {
        PATH: process.env.PATH,
        HOME: installDir,
        BUN_INSTALL: join(installDir, ".bun"),
        XDG_CACHE_HOME: join(installDir, ".cache"),
      };
      runReleaseArtifactCommand(
        process.execPath,
        ["add", "--cwd", installDir, tarball, "--minimum-release-age=0"],
        root,
        isolatedEnv,
      );
      expect(JSON.parse(readFileSync(join(installDir, "node_modules", "@hasna", "contracts", "package.json"), "utf8")).name)
        .toBe("@hasna/contracts");
      expect(runReleaseArtifactCommand(
        join(installDir, "node_modules", ".bin", "todos"),
        ["--version"],
        installDir,
        isolatedEnv,
      ).trim()).toBe(packageJson.version);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, 120_000);

  test("uses deterministic provenance time and requires two identical clean tarballs", () => {
    expect(resolveReleaseProvenanceTimestamp("1784361600", "1")).toBe("2026-07-18T08:00:00.000Z");
    expect(resolveReleaseProvenanceTimestamp(undefined, "1784361600")).toBe("2026-07-18T08:00:00.000Z");
    expect(() => resolveReleaseProvenanceTimestamp("not-an-epoch", "1784361600")).toThrow("SOURCE_DATE_EPOCH");
    expect(validateReproducibleArtifactIntegrity("sha512-YWJj", "sha512-YWJj")).toEqual([]);
    expect(validateReproducibleArtifactIntegrity("sha512-YWJj", "sha512-YWJj", "manifest-a", "manifest-b")
      .map((failure) => failure.check)).toEqual(["payload-reproducibility"]);
    expect(validateReproducibleArtifactIntegrity("sha512-YWJj", "sha512-ZGVm").map((failure) => failure.check))
      .toEqual(["tarball-reproducibility"]);
  });

  test("rejects tracked worktree blob, mode, symlink, and type drift from HEAD", () => {
    expect(validateTrackedWorktreeProof([
      { path: "src/a.ts", headType: "blob", headMode: "100644", headObject: "a", actualType: "blob", actualMode: "100644", actualObject: "a" },
    ])).toEqual([]);
    const failures = validateTrackedWorktreeProof([
      { path: "src/bytes.ts", headType: "blob", headMode: "100644", headObject: "a", actualType: "blob", actualMode: "100644", actualObject: "b" },
      { path: "bin/tool", headType: "blob", headMode: "100755", headObject: "c", actualType: "blob", actualMode: "100644", actualObject: "c" },
      { path: "link", headType: "blob", headMode: "120000", headObject: "d", actualType: "symlink", actualMode: "120000", actualObject: "e" },
      { path: "missing", headType: "blob", headMode: "100644", headObject: "f", actualType: "missing", actualMode: null, actualObject: null },
    ]);
    expect(new Set(failures.map((failure) => failure.check))).toEqual(new Set([
      "release-tracked-blob", "release-tracked-mode", "release-tracked-symlink", "release-tracked-type",
    ]));
  });

  test("rejects final-pack mutation lifecycle scripts and requires explicit release modes", () => {
    expect(validatePackLifecycleScripts(rootPackage)).toEqual([]);
    expect(validatePackLifecycleScripts({
      ...rootPackage,
      scripts: { ...rootPackage.scripts, prepack: "node mutate.js", prepare: "node mutate.js" },
    }).map((failure) => failure.check)).toEqual(["pack-lifecycle-mutation", "pack-lifecycle-mutation"]);
    expect(validateRootPackageMetadata({ ...rootPackage, packageManager: "bun@1.3.13" })
      .map((failure) => failure.check)).toContain("package-manager");
    expect(getNpmPackArgs("/tmp/output")).toEqual([
      "pack", "--ignore-scripts", "--json", "--pack-destination", "/tmp/output",
    ]);
    expect(validateBunReleaseToolchain("1.3.14")).toEqual([]);
    expect(validateBunReleaseToolchain("1.3.13").map((failure) => failure.check)).toEqual([
      "release-bun-version",
    ]);
  });

  test("binds release provenance to the exact commit tree and source hash", () => {
    const provenance = {
      packageName: "@hasna/todos",
      packageVersion: rootPackage.version,
      repository: "https://github.com/hasna/todos.git",
      gitCommit: "0".repeat(40),
      gitTree: "1".repeat(40),
      sourceTreeSha256: "2".repeat(64),
      generatedAt: "2026-07-18T00:00:00.000Z",
    };
    const failures = validateReleaseProvenanceMetadata(provenance, rootPackage, {
      gitCommit: "3".repeat(40),
      gitTree: "4".repeat(40),
      sourceTreeSha256: "5".repeat(64),
    });
    expect(failures.map((failure) => failure.check)).toEqual([
      "provenance-commit-match",
      "provenance-tree-match",
      "provenance-source-hash-match",
    ]);
  });

  test("keeps the Bun install smoke plan public, local, and stable", () => {
    const plan = getInstallSmokeCommands("/tmp/hasna-todos.tgz", "19717", "/tmp/isolated-todos");
    const rendered = plan.map((step) => [step.command, ...step.args].join(" "));

    expect(validateInstallSmokeCommands(plan)).toEqual([]);
    expect(rendered).toContain("bun add --cwd /tmp/isolated-todos /tmp/hasna-todos.tgz --minimum-release-age=0");
    expect(rendered).toContain("bash -lc test -x /tmp/isolated-todos/node_modules/.bin/todos && test -x /tmp/isolated-todos/node_modules/.bin/todos-mcp && test -x /tmp/isolated-todos/node_modules/.bin/todos-serve");
    expect(rendered).toContain("/tmp/isolated-todos/node_modules/.bin/todos --version");
    expect(rendered).toContain("/tmp/isolated-todos/node_modules/.bin/todos --help");
    expect(rendered).toContain("/tmp/isolated-todos/node_modules/.bin/todos-mcp --help");
    expect(rendered).toContain("/tmp/isolated-todos/node_modules/.bin/todos-serve --port=19717 --host 127.0.0.1 --no-open");
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
