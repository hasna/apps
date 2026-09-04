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
  files: ["dist", "LICENSE", "README.md"],
  workspaces: ["ai"],
  publishConfig: { registry: "https://registry.npmjs.org", access: "public" },
  repository: { type: "git", url: "https://github.com/hasna/todos.git" },
  homepage: "https://github.com/hasna/todos",
  bugs: { url: "https://github.com/hasna/todos/issues" },
  dependencies: { chalk: "^5.4.1" },
  packageManager: "bun@1.3.14",
  scripts: {
    "verify:release": "bun run scripts/verify-public-release.ts --mode=review",
    "verify:release-review": "bun run scripts/verify-npm-release-agent-review.ts",
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

  test("exempts only the known-safe contracts sentinel in dist/server/index.js from the secret scan", () => {
    // P1 from the @hasna/todos@0.15.41 release review (2026-08-22): the server build
    // target inlines the @hasna/contracts graph, whose known-safe issuance-state
    // constant API_KEY_ISSUANCE_PENDING_REASON = "credential_delivery_pending" matches
    // the keyword-assignment secret detector by shape. Split-string spellings so this
    // test file itself does not trip the assignment-shape detectors it exercises.
    const sentinel = "API_KEY" + "_ISSUANCE_PENDING_REASON = " + '"credential_delivery_pending";';

    // Positive control: the sentinel alone in the server bundle passes the scan.
    const positive = validatePublicTextSurfaces([{ path: "package/dist/server/index.js", text: sentinel }]);
    expect(positive.filter((failure) => failure.check === "secret-scan")).toEqual([]);

    // Negative control A: a real secret-shaped assignment beside the sentinel in the
    // same module still fails — the exemption strips the occurrence, not the pattern.
    const withRealSecret = sentinel + "\n" + "SECRET" + "_API_TOKEN = " + '"real-looking-value-12345";';
    const negativeA = validatePublicTextSurfaces([{ path: "package/dist/server/index.js", text: withRealSecret }]);
    expect(negativeA.filter((failure) => failure.check === "secret-scan")).toHaveLength(1);

    // Negative control B: the same sentinel literal in a DIFFERENT module is not
    // exempted — the exemption names dist/server/index only.
    const negativeB = validatePublicTextSurfaces([{ path: "package/dist/cli/index.js", text: sentinel }]);
    expect(negativeB.filter((failure) => failure.check === "secret-scan")).toHaveLength(1);

    // Negative control C: a second keyword-assignment shape with a different name in
    // the exempt module survives the strip and still fails.
    const negativeC = validatePublicTextSurfaces([
      { path: "package/dist/server/index.js", text: sentinel + "\n" + "API_KEY" + "_ROTATION_TOKEN = " + '"another-value-123456";' },
    ]);
    expect(negativeC.filter((failure) => failure.check === "secret-scan")).toHaveLength(1);
  });

  test("reads the root README for the install check whatever order the surfaces arrive in", () => {
    // Regression for @hasna/todos@0.15.0 publish run 30829940563, which failed
    // readme-install at a sha whose README.md contained the required line twice.
    // The selector also matched sdk/README.md, and the source collector feeds it
    // unsorted readdirSync order, so the file the check read was decided by the
    // filesystem. Both orders below must reach the same verdict.
    const rootReadme = { path: "README.md", text: "# todos\n\nbun install -g @hasna/todos\n" };
    const sdkReadme = { path: "sdk/README.md", text: "# todos-sdk\n\nbun add @hasna/todos-sdk\n" };
    const readmeInstall = (files: { path: string; text: string }[]) =>
      validatePublicTextSurfaces(files).filter((failure) => failure.check === "readme-install");

    expect(readmeInstall([rootReadme, sdkReadme])).toEqual([]);
    expect(readmeInstall([sdkReadme, rootReadme])).toEqual([]);

    // The packed scan prefixes every entry with `package/`; the root README of an
    // extracted tarball must resolve the same way, and its sdk sibling must not.
    expect(readmeInstall([
      { path: "package/sdk/README.md", text: sdkReadme.text },
      { path: "package/README.md", text: rootReadme.text },
    ])).toEqual([]);
  });

  test("a sibling README cannot satisfy the install requirement for a root README that omits it", () => {
    // The inverse failure the old suffix match allowed: a compliant sdk/README.md
    // enumerated first would have masked a root README missing the install line.
    const failures = validatePublicTextSurfaces([
      { path: "sdk/README.md", text: "bun install -g @hasna/todos\n" },
      { path: "README.md", text: "# todos\n\nno install instructions here\n" },
    ]).filter((failure) => failure.check === "readme-install");

    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toContain("README.md must document bun install -g @hasna/todos");
  });

  test("distinguishes an uncollected README from one that omits the install command", () => {
    // `?? ""` used to turn "never collected" into "collected and empty", so a
    // collection bug was reported as a content bug against a file the gate had
    // never opened. The two states must not share a message.
    const absent = validatePublicTextSurfaces([{ path: "docs/roadmaps.md", text: "" }])
      .filter((failure) => failure.check === "readme-install");
    expect(absent).toHaveLength(1);
    expect(absent[0]?.message).toContain("no root README.md was collected");
    expect(absent[0]?.message).toContain("docs/roadmaps.md");

    const omits = validatePublicTextSurfaces([{ path: "README.md", text: "# todos\n" }])
      .filter((failure) => failure.check === "readme-install");
    expect(omits).toHaveLength(1);
    expect(omits[0]?.message).toContain("README.md must document");
    expect(omits[0]?.message).not.toContain("no root README.md was collected");
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

  test("the test-isolation module may name the legacy routing aliases it exists to blank", () => {
    // src/testing.ts is the one shipped module that must SPELL the legacy unprefixed
    // hosted-routing variables, because blanking them is the whole point of the module —
    // a scrub list that cannot name a variable cannot scrub it. src/no-cloud-boundary.test.ts
    // already carries exactly this exemption for the source file; the packed artifacts are
    // the same text after compilation and need the same one, or the export can be built,
    // merged and tested but never published.
    // Scoped to the boundary check: validatePublicTextSurfaces also enforces readme-install
    // across whatever set it is handed, which is not what this test is about.
    const boundaryFailures = (files: { path: string; text: string }[]) =>
      validatePublicTextSurfaces(files).filter((failure) => failure.check === "public-text-boundary");

    for (const path of ["package/dist/testing.js", "package/dist/testing.d.ts", "dist/testing.js"]) {
      expect(
        boundaryFailures([{ path, text: 'const SHARED = ["HASNA_TODOS_API_URL", "TODOS_API_URL"];' }]),
      ).toEqual([]);
    }

    // The exemption is by exact file AND exact pattern. It must not turn dist/testing.js
    // into a hole for everything else the boundary forbids...
    const otherViolation = validatePublicTextSurfaces([
      { path: "package/dist/testing.js", text: `const region = "AWS_REGION";` },
    ]);
    expect(otherViolation.map((failure) => failure.check)).toContain("public-text-boundary");

    // ...nor may any OTHER shipped file name the legacy alias.
    const otherFile = validatePublicTextSurfaces([
      { path: "package/dist/index.js", text: 'const url = env["TODOS_API_URL"];' },
    ]);
    expect(otherFile.map((failure) => failure.check)).toContain("public-text-boundary");
  });

  test("the bundled server module may carry contracts' forbidden-runtime NAMES as inert schema data", () => {
    // @hasna/contracts ships FORBIDDEN_SHARED_CLOUD_RUNTIMES = ["@hasna/cloud", "open-cloud"] —
    // a validator constant that NAMES the runtimes a manifest must not depend on. It is data,
    // not a dependency edge. `bun build src/server/index.ts` does not externalize
    // @hasna/contracts (unlike the CLI/MCP/SDK targets), so since #153/#154 made the server
    // bundle self-contained, that literal array is inlined into dist/server/index.js and a
    // text scanner cannot tell "names a forbidden runtime" from "depends on one". Without this
    // exemption every publish dies here — verified by removing it and observing this same test
    // fail with `public-text-boundary` on package/dist/server/index.js.
    const boundaryFailures = (files: { path: string; text: string }[]) =>
      validatePublicTextSurfaces(files).filter((failure) => failure.check === "public-text-boundary");

    const contractsConstant = 'var FORBIDDEN_SHARED_CLOUD_RUNTIMES = ["@hasna/cloud", "open-cloud"];';
    for (const path of ["package/dist/server/index.js", "dist/server/index.js"]) {
      expect(boundaryFailures([{ path, text: contractsConstant }])).toEqual([]);
    }

    // The exemption is by exact file AND exact pattern. It must not turn dist/server/index.js
    // into a hole for everything else the boundary forbids...
    const otherViolation = validatePublicTextSurfaces([
      { path: "package/dist/server/index.js", text: `const region = "AWS_REGION";` },
    ]);
    expect(otherViolation.map((failure) => failure.check)).toContain("public-text-boundary");

    // ...nor may any OTHER shipped file (including a sibling under dist/server/) name a
    // forbidden runtime — a genuine dependency on @hasna/cloud or open-cloud must still fail.
    for (const path of ["package/dist/index.js", "package/dist/server/helpers.js"]) {
      const otherFile = validatePublicTextSurfaces([{ path, text: 'const runtime = "@hasna/cloud";' }]);
      expect(otherFile.map((failure) => failure.check)).toContain("public-text-boundary");
    }

    // THE CASE THE FIRST VERSION OF THIS EXEMPTION MISSED (PR #161 review, NO_GO,
    // comment 5155307992): the exemption was keyed on (module, pattern), which exempts the
    // PATTERN IN THAT FILE — not just the one known-inert literal. A real dependency on
    // @hasna/cloud planted in the SAME file as the contracts literal produced zero
    // public-text-boundary failures, because the whole file was blind to the pattern once
    // exempted. dist/server/index.js is exactly the wrong file for that hole: it has no
    // --external flags at all, so it inlines everything the server imports, including any
    // future @hasna/contracts release that ships real (non-schema) code touching either
    // runtime. The fix strips only the known-safe array-literal substring before re-testing
    // the pattern, so a real reference alongside it still surfaces.
    const literalPlusRealDependency = [
      'var FORBIDDEN_SHARED_CLOUD_RUNTIMES = ["@hasna/cloud", "open-cloud"];',
      'const cloudClient = require("@hasna/cloud");',
      "cloudClient.connect();",
    ].join("\n");
    expect(
      boundaryFailures([{ path: "package/dist/server/index.js", text: literalPlusRealDependency }])
        .map((failure) => failure.message),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining("package/dist/server/index.js matches forbidden pattern")]),
    );

    // And a genuine open-cloud reference ALONE, with no contracts literal anywhere in the
    // file, must still fail — the exemption never applies when the safe occurrence is absent.
    expect(
      boundaryFailures([{ path: "package/dist/server/index.js", text: 'import x from "open-cloud";\nx();' }]),
    ).not.toEqual([]);
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
      ]),
    ).toEqual([]);

    const failures = validatePackedPackageFiles(["package/package.json", "package/src/index.ts", "package/.env"]);
    expect(failures.map((failure) => failure.check)).toContain("pack-contents");
    expect(failures.map((failure) => failure.check)).toContain("pack-source");
    expect(failures.map((failure) => failure.check)).toContain("pack-env");
  });

  test("the storage-mode vocabulary is gone from every bundle but the test scrub list and runbook", () => {
    // The deployment-mode removal is complete: no runtime module may name the
    // retired storage-mode keys at all. The only surviving surfaces are the
    // test-isolation scrub list (which must NAME the keys it deletes so tests
    // never depend on them) and the cutover runbook retirement sentence. The
    // exemptions strip ONLY the exact emitted array-tail / assignment /
    // retirement-sentence shapes — any other spelling (a bracket-indexed read,
    // a bare token in a different context, a live assignment with a value)
    // survives and still fails. Mirrors the source-level exemptions
    // src/no-cloud-boundary.test.ts carries for the same vocabulary.
    const boundaryFailures = (files: { path: string; text: string }[]) =>
      validatePublicTextSurfaces(files).filter((failure) => failure.check === "public-text-boundary");

    // The retired ratchet array shape is now FORBIDDEN everywhere except the
    // test-isolation scrub list (dist/testing).
    const ratchetJs = 'const R = [\n  "HASNA_TODOS_STORAGE_MODE",\n  "HASNA_TODOS_MODE",\n  "TODOS_STORAGE_MODE",\n  "TODOS_MODE",\n];';
    const ratchetDts = 'export const R: readonly string[] = ["HASNA_TODOS_STORAGE_MODE", "HASNA_TODOS_MODE", "TODOS_STORAGE_MODE", "TODOS_MODE"];';
    for (const module of [
      "dist/cli/index",
      "dist/index",
      "dist/mcp/index",
      "dist/server/index",
      "dist/storage",
      "dist/storage/config",
      "dist/registry",
      "dist/contracts",
      "dist/project-registration",
    ]) {
      for (const path of [`package/${module}.js`, `package/${module}.d.ts`, `${module}.js`]) {
        expect(boundaryFailures([{ path, text: ratchetJs }])).not.toEqual([]);
        expect(boundaryFailures([{ path, text: ratchetDts }])).not.toEqual([]);
      }
    }

    // The test-isolation scrub list still names the keys it deletes — exempt in both emits.
    for (const path of ["package/dist/testing.js", "package/dist/testing.d.ts", "dist/testing.js"]) {
      expect(boundaryFailures([{ path, text: ratchetJs }])).toEqual([]);
      expect(boundaryFailures([{ path, text: ratchetDts }])).toEqual([]);
    }

    // The admitted-local redaction assignment shape (src/cli/stage-a.ts emit) passes only
    // in the module that bundles it, and only in that exact shape.
    expect(
      boundaryFailures([{ path: "package/dist/cli/index.js", text: 'env.TODOS_API_URL = "";' }]),
    ).toEqual([]);

    // The runbook retirement sentence passes as a docs surface.
    expect(
      boundaryFailures([{
        path: "docs/CUTOVER-RUNBOOK.md",
        text: "> `HASNA_TODOS_MODE`, `TODOS_MODE`) are RETIRED (owner directive 2026-08-15):",
      }]),
    ).toEqual([]);

    // Negative controls: a live bracket-indexed read in an exempted module still fails...
    const liveRead = boundaryFailures([
      { path: "package/dist/cli/index.js", text: 'const m = env["TODOS_MODE"];' },
      { path: "package/dist/cli/index.js", text: 'const url = env["TODOS_API_URL"];' },
    ]);
    expect(liveRead.map((failure) => failure.check)).toContain("public-text-boundary");

    // ...a module that does NOT bundle the ratchet still fails on the same literal...
    const unbundled = boundaryFailures([
      { path: "package/dist/capabilities.js", text: ratchetJs },
    ]);
    expect(unbundled.length).toBeGreaterThan(0);

    // ...and a bare mention in the runbook OUTSIDE the retirement sentence still fails.
    const runbookBare = boundaryFailures([
      { path: "docs/CUTOVER-RUNBOOK.md", text: "export TODOS_MODE=remote" },
    ]);
    expect(runbookBare.map((failure) => failure.check)).toContain("public-text-boundary");
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
      ...expected,
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

  test("names the dirty paths so a failed release does not have to be reproduced to find them", () => {
    const single = validateReleaseRepositoryState("?? src/generated-fixture.json\n")[0]!.message;
    expect(single).toContain("1 change found");
    expect(single).toContain("?? src/generated-fixture.json");

    const pair = validateReleaseRepositoryState(" M package.json\n?? untracked.txt\n")[0]!.message;
    expect(pair).toContain("2 changes found");
    expect(pair).toContain(" M package.json");
    expect(pair).toContain("?? untracked.txt");

    // The cap keeps a pathological tree from burying every other failure, and
    // still reports the true total rather than the truncated one.
    const many = validateReleaseRepositoryState(
      Array.from({ length: 25 }, (_, index) => `?? file-${index}.txt`).join("\n"),
    )[0]!.message;
    expect(many).toContain("25 changes found");
    expect(many).toContain("?? file-0.txt");
    expect(many).toContain("?? file-19.txt");
    expect(many).not.toContain("?? file-20.txt");
    expect(many).toContain("and 5 more");
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

  test("detects packed text by content and rejects packed binary files", () => {
    expect(isPackedTextContent(Buffer.from("Apache License\nAWS_PRIVATE_MARKER\n"))).toBe(true);
    expect(isPackedTextContent(Buffer.from("{\"version\":3}\n"))).toBe(true);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0xff, 0xd9]);
    expect(isPackedTextContent(jpeg)).toBe(false);
    // The tarball ships no binaries — every packed binary file is rejected.
    expect(validatePackedBinaryFile("package/dist/native.node"))
      .toEqual([{ check: "pack-binary-allowlist", message: "packed binary file is not allowlisted: package/dist/native.node" }]);
  });

  test("scans multi-megabyte extracted package entries without subprocess truncation", () => {
    const root = mkdtempSync(join(tmpdir(), "todos-packed-scan-"));
    try {
      const entry = join(root, "package", "dist", "cli", "index.js");
      mkdirSync(join(root, "package", "dist", "cli"), { recursive: true });
      writeFileSync(entry, `${"x".repeat(2 * 1024 * 1024)}\nAWS_PRIVATE_MARKER\n`);
      const failures = scanExtractedPackedFiles([{ path: "dist/cli/index.js" }], root);
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
    expect(validatePackLifecycleScripts({
      ...rootPackage,
      scripts: { ...rootPackage.scripts, "verify:release-review": "true" },
    }).map((failure) => failure.check)).toContain("release-agent-review-script");
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
