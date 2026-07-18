import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createReleaseCompatibilityReport, renderReleaseCompatibilityMarkdown } from "./release-compatibility.js";
import { createReleaseArtifactManifest } from "./release-artifact-manifest.js";

const repositoryRoot = join(import.meta.dir, "../..");

function createUnbuiltFixture(): string {
  const fixture = mkdtempSync(join(tmpdir(), "todos-release-compatibility-unbuilt-"));
  writeFileSync(join(fixture, "package.json"), readFileSync(join(repositoryRoot, "package.json")));
  writeFileSync(join(fixture, "bun.lock"), readFileSync(join(repositoryRoot, "bun.lock")));
  return fixture;
}

function withFixtureGit<T>(fixture: string, callback: () => T): T {
  const bin = join(fixture, "fixture-bin");
  const git = join(bin, "git");
  mkdirSync(bin, { recursive: true });
  writeFileSync(git, [
    "#!/bin/sh",
    `if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then printf '%s\\n' '${"a".repeat(40)}'`,
    `elif [ "$1" = "rev-parse" ] && [ "$2" = "HEAD^{tree}" ]; then printf '%s\\n' '${"b".repeat(40)}'`,
    "elif [ \"$1\" = \"ls-tree\" ]; then printf 'fixture-tree-listing\\000'",
    "else exit 2",
    "fi",
    "",
  ].join("\n"));
  chmodSync(git, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  try {
    const probe = spawnSync("git", ["rev-parse", "HEAD"], { cwd: fixture, encoding: "utf8", env: process.env });
    if (probe.status !== 0) throw new Error(`fixture git probe failed: ${probe.error?.message ?? probe.stderr ?? "unknown"}`);
    return callback();
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
}

describe("release compatibility checks", () => {
  test("builds a local-only compatibility report from an isolated unbuilt fixture", () => {
    const fixture = createUnbuiltFixture();
    try {
      const report = createReleaseCompatibilityReport({
        root: fixture,
        generated_at: "2026-01-02T03:04:05.000Z",
        simulated_levels: [0, 1],
      });

      expect(report).toMatchObject({
        schema_version: 1,
        local_only: true,
        no_network: true,
        generated_at: "2026-01-02T03:04:05.000Z",
        package: {
          name: "@hasna/todos",
          repository: "https://github.com/hasna/todos.git",
          public: true,
        },
        install_plan: {
          package: "@hasna/todos",
          manager: "bun",
        },
        changelog: {
          command: "todos release-notes --format markdown",
          mcp_tool: "generate_release_notes",
          json_contract: "release_notes",
        },
      });
      expect(report.ok).toBe(false);
      expect(report.issues).toEqual([]);
      expect(report.warnings).toContain("Built server runtime is absent; run the release build before claiming compatibility.");
      expect(report.exports.actual).toEqual(expect.arrayContaining([".", "./contracts", "./mcp", "./sdk", "./storage"]));
      expect(report.bins.actual).toEqual(expect.arrayContaining(["todos", "todos-mcp", "todos-serve"]));
      expect(report.install_plan.commands.every((command) => command.startsWith("bun ") || command.startsWith("todos"))).toBe(true);
      expect(JSON.stringify(report.install_plan)).not.toContain("bun add");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("simulates recent migration levels into the current schema", () => {
    const fixture = createUnbuiltFixture();
    try {
      const report = createReleaseCompatibilityReport({
        root: fixture,
        simulated_levels: [0, 1, 50],
      });

      expect(report.migrations.current_level).toBeGreaterThanOrEqual(50);
      expect(report.checks.filter((check) => check.id.startsWith("migration-level-"))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "migration-level-0", status: "passed" }),
          expect.objectContaining({ id: "migration-level-1", status: "passed" }),
          expect.objectContaining({ id: "migration-level-50", status: "passed" }),
        ]),
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("renders operator-friendly install and rollback guidance", () => {
    const fixture = createUnbuiltFixture();
    try {
      const report = createReleaseCompatibilityReport({
        root: fixture,
        generated_at: "2026-01-02T03:04:05.000Z",
        simulated_levels: [0],
      });
      const markdown = renderReleaseCompatibilityMarkdown(report);

      expect(markdown).toContain("# Release Compatibility");
      expect(markdown).toContain("Status: failed");
      expect(markdown).toContain("bun install -g @hasna/todos@latest");
      expect(markdown).toContain("bun install -g @hasna/todos@<previous-version>");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("passes only after checking strict publish wiring and a self-contained built server", () => {
    const fixture = mkdtempSync(join(tmpdir(), "todos-release-compatibility-"));
    try {
      const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
      const lockfile = readFileSync(join(repositoryRoot, "bun.lock"));
      const lockfileSha256 = new Bun.CryptoHasher("sha256").update(lockfile).digest("hex");
      writeFileSync(join(fixture, "package.json"), `${JSON.stringify(packageJson)}\n`);
      writeFileSync(join(fixture, "bun.lock"), lockfile);
      mkdirSync(join(fixture, "src", "server"), { recursive: true });
      writeFileSync(join(fixture, "src", "server", "index.ts"), [
        `export const releaseFixtureVersion = ${JSON.stringify(packageJson.version)};`,
        "if (import.meta.main && process.argv.includes('--version')) process.stdout.write(`${releaseFixtureVersion}\\n`);",
        "",
      ].join("\n"));
      const gitCommit = "a".repeat(40);
      const gitTree = "b".repeat(40);
      const sourceTreeSha256 = new Bun.CryptoHasher("sha256")
        .update(Buffer.from("fixture-tree-listing\0"))
        .digest("hex");
      const build = spawnSync(process.execPath, [
        "build",
        "src/server/index.ts",
        "--outdir",
        "dist/server",
        "--target",
        "bun",
        "--reject-unresolved",
      ], { cwd: fixture, encoding: "utf8" });
      if (build.status !== 0) throw new Error(`fixture server build failed: ${build.stderr || build.stdout}`);
      mkdirSync(join(fixture, "dashboard", "dist", "assets"), { recursive: true });
      writeFileSync(join(fixture, "dashboard", "dist", "index.html"), [
        '<div id="root"></div>',
        '<link rel="stylesheet" href="/assets/app.css">',
        '<script type="module" src="/assets/app.js"></script>',
        "",
      ].join("\n"));
      writeFileSync(join(fixture, "dashboard", "dist", "assets", "app.css"), "#root { display: block; }\n");
      writeFileSync(join(fixture, "dashboard", "dist", "assets", "app.js"), "document.querySelector('#root');\n");
      const serverBundle = readFileSync(join(fixture, "dist", "server", "index.js"));
      const provenance = {
        packageName: packageJson.name,
        packageVersion: packageJson.version,
        repository: "https://github.com/hasna/todos.git",
        gitCommit,
        gitTree,
        sourceTreeSha256,
        generatedAt: "2026-07-18T00:00:00.000Z",
        toolchain: { bunVersion: "1.3.14" },
        dependencies: {
          lockfile: "bun.lock",
          lockfileSha256,
          installCommand: "bun install --frozen-lockfile --ignore-scripts --minimum-release-age=604800",
          isolatedSource: true,
        },
        gate: { mode: "publish", authoritative: true, skippedChecks: [] },
        artifacts: createReleaseArtifactManifest(fixture),
      };
      writeFileSync(join(fixture, "dist", "release-provenance.json"), `${JSON.stringify(provenance)}\n`);

      const report = withFixtureGit(fixture, () => (
        createReleaseCompatibilityReport({ root: fixture, simulated_levels: [0] })
      ));
      expect(report.ok).toBe(true);
      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "prepublish-exact-command", status: "passed" }),
        expect.objectContaining({ id: "server-runtime-build", status: "passed" }),
        expect.objectContaining({ id: "server-runtime-contracts", status: "passed" }),
        expect.objectContaining({ id: "server-runtime-provenance", status: "passed" }),
        expect.objectContaining({ id: "install-smoke-plan", status: "passed" }),
      ]));

      writeFileSync(join(fixture, "dist", "server", "index.js"), "console.log('substituted after provenance');\n");
      const substitutedArtifact = withFixtureGit(fixture, () => (
        createReleaseCompatibilityReport({ root: fixture, simulated_levels: [0] })
      ));
      expect(substitutedArtifact.ok).toBe(false);
      expect(substitutedArtifact.checks).toContainEqual(expect.objectContaining({
        id: "server-runtime-provenance",
        status: "failed",
      }));
      writeFileSync(join(fixture, "dist", "server", "index.js"), serverBundle);

      unlinkSync(join(fixture, "dashboard", "dist", "assets", "app.css"));
      const missingArtifact = withFixtureGit(fixture, () => (
        createReleaseCompatibilityReport({ root: fixture, simulated_levels: [0] })
      ));
      const missingProvenance = missingArtifact.checks.find((check) => check.id === "server-runtime-provenance");
      expect(missingArtifact.ok).toBe(false);
      expect((missingProvenance?.details?.failures as Array<{ check: string }>).map((failure) => failure.check))
        .toContain("provenance-artifact-missing");
      writeFileSync(join(fixture, "dashboard", "dist", "assets", "app.css"), "#root { display: block; }\n");

      writeFileSync(join(fixture, "dist", "release-provenance.json"), `${JSON.stringify({
        ...provenance,
        gitCommit: "f".repeat(40),
        gitTree: "e".repeat(40),
        sourceTreeSha256: "d".repeat(64),
      })}\n`);
      const staleSource = withFixtureGit(fixture, () => (
        createReleaseCompatibilityReport({ root: fixture, simulated_levels: [0] })
      ));
      expect(staleSource.ok).toBe(false);
      expect(staleSource.checks).toContainEqual(expect.objectContaining({
        id: "server-runtime-provenance",
        status: "failed",
      }));

      writeFileSync(join(fixture, "dist", "release-provenance.json"), `${JSON.stringify({
        ...provenance,
        gate: { mode: "review", authoritative: false, skippedChecks: ["npm-view"] },
      })}\n`);
      const nonAuthoritative = withFixtureGit(fixture, () => (
        createReleaseCompatibilityReport({ root: fixture, simulated_levels: [0] })
      ));
      expect(nonAuthoritative.ok).toBe(false);
      expect(nonAuthoritative.checks).toContainEqual(expect.objectContaining({
        id: "server-runtime-provenance",
        status: "failed",
      }));

      writeFileSync(join(fixture, "dist", "release-provenance.json"), `${JSON.stringify(provenance)}\n`);
      writeFileSync(join(fixture, "dist", "server", "index.js"), "import '@hasna/contracts/auth';\n");
      const incomplete = withFixtureGit(fixture, () => (
        createReleaseCompatibilityReport({ root: fixture, simulated_levels: [0] })
      ));
      expect(incomplete.ok).toBe(false);
      expect(incomplete.checks).toContainEqual(expect.objectContaining({
        id: "server-runtime-contracts",
        status: "failed",
      }));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
