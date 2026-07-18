import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createReleaseCompatibilityReport, renderReleaseCompatibilityMarkdown } from "./release-compatibility.js";

function runGit(cwd: string, args: string[]): Buffer {
  const result = spawnSync("git", args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.toString("utf8") ?? "unknown error"}`);
  }
  return result.stdout ?? Buffer.alloc(0);
}

describe("release compatibility checks", () => {
  test("builds a local-only compatibility report for the current package", () => {
    const report = createReleaseCompatibilityReport({
      root: process.cwd(),
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
  });

  test("simulates recent migration levels into the current schema", () => {
    const report = createReleaseCompatibilityReport({
      root: process.cwd(),
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
  });

  test("renders operator-friendly install and rollback guidance", () => {
    const report = createReleaseCompatibilityReport({
      root: process.cwd(),
      generated_at: "2026-01-02T03:04:05.000Z",
      simulated_levels: [0],
    });
    const markdown = renderReleaseCompatibilityMarkdown(report);

    expect(markdown).toContain("# Release Compatibility");
    expect(markdown).toContain("Status: failed");
    expect(markdown).toContain("bun install -g @hasna/todos@latest");
    expect(markdown).toContain("bun install -g @hasna/todos@<previous-version>");
  });

  test("passes only after checking strict publish wiring and a self-contained built server", () => {
    const fixture = mkdtempSync(join(tmpdir(), "todos-release-compatibility-"));
    try {
      const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
      const lockfile = readFileSync(join(process.cwd(), "bun.lock"));
      const lockfileSha256 = new Bun.CryptoHasher("sha256").update(lockfile).digest("hex");
      mkdirSync(join(fixture, "dist", "server"), { recursive: true });
      writeFileSync(join(fixture, "package.json"), `${JSON.stringify(packageJson)}\n`);
      writeFileSync(join(fixture, "bun.lock"), lockfile);
      runGit(fixture, ["init", "--quiet"]);
      runGit(fixture, ["add", "package.json", "bun.lock"]);
      runGit(fixture, ["-c", "user.name=Todos Release Test", "-c", "user.email=todos-release@example.invalid", "commit", "--quiet", "-m", "fixture"]);
      const gitCommit = runGit(fixture, ["rev-parse", "HEAD"]).toString("utf8").trim();
      const gitTree = runGit(fixture, ["rev-parse", "HEAD^{tree}"]).toString("utf8").trim();
      const sourceTreeSha256 = new Bun.CryptoHasher("sha256")
        .update(runGit(fixture, ["ls-tree", "-r", "--full-tree", "-z", "HEAD"]))
        .digest("hex");
      writeFileSync(join(fixture, "dist", "server", "index.js"), "console.log('self-contained');\n");
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
      };
      writeFileSync(join(fixture, "dist", "release-provenance.json"), `${JSON.stringify(provenance)}\n`);

      const report = createReleaseCompatibilityReport({ root: fixture, simulated_levels: [0] });
      expect(report.ok).toBe(true);
      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "prepublish-exact-command", status: "passed" }),
        expect.objectContaining({ id: "server-runtime-build", status: "passed" }),
        expect.objectContaining({ id: "server-runtime-contracts", status: "passed" }),
        expect.objectContaining({ id: "server-runtime-provenance", status: "passed" }),
        expect.objectContaining({ id: "install-smoke-plan", status: "passed" }),
      ]));

      writeFileSync(join(fixture, "dist", "release-provenance.json"), `${JSON.stringify({
        ...provenance,
        gitCommit: "f".repeat(40),
        gitTree: "e".repeat(40),
        sourceTreeSha256: "d".repeat(64),
      })}\n`);
      const staleSource = createReleaseCompatibilityReport({ root: fixture, simulated_levels: [0] });
      expect(staleSource.ok).toBe(false);
      expect(staleSource.checks).toContainEqual(expect.objectContaining({
        id: "server-runtime-provenance",
        status: "failed",
      }));

      writeFileSync(join(fixture, "dist", "release-provenance.json"), `${JSON.stringify({
        ...provenance,
        gate: { mode: "review", authoritative: false, skippedChecks: ["npm-view"] },
      })}\n`);
      const nonAuthoritative = createReleaseCompatibilityReport({ root: fixture, simulated_levels: [0] });
      expect(nonAuthoritative.ok).toBe(false);
      expect(nonAuthoritative.checks).toContainEqual(expect.objectContaining({
        id: "server-runtime-provenance",
        status: "failed",
      }));

      writeFileSync(join(fixture, "dist", "release-provenance.json"), `${JSON.stringify(provenance)}\n`);
      writeFileSync(join(fixture, "dist", "server", "index.js"), "import '@hasna/contracts/auth';\n");
      const incomplete = createReleaseCompatibilityReport({ root: fixture, simulated_levels: [0] });
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
