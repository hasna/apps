/**
 * Turbo task-graph acyclicity — standard-adherence suite.
 *
 * The root `build` task declares `dependsOn: ["^build"]`, which traverses
 * BOTH dependencies and devDependencies. That made the package graph cyclic
 * when two workspace members depended on each other in opposite dep classes:
 *
 *   @hasna/contracts (dependencies: @hasna/secrets)
 *     <-> @hasna/secrets (devDependencies: @hasna/contracts)
 *
 * `turbo run build` (full and --affected) then failed at package-graph
 * construction with rc=1 and "Cyclic dependency detected: @hasna/secrets,
 * @hasna/contracts" — the CI build+test job failed at any head once install
 * passed (todos d2776e8f). Measured: turbo 2.5.4 rejects the cyclic PACKAGE
 * graph itself (a per-package task override cannot fix it) and traverses
 * dependencies, devDependencies and optionalDependencies but NOT
 * peerDependencies.
 *
 * The two edges are each real, in different senses:
 *   - contracts -> secrets is RUNTIME-load-bearing: the published tarball
 *     resolves the non-literal dynamic import in src/cli/secrets-bridge.ts
 *     through the declared dependency (`issue-key --secrets-ref`).
 *   - secrets -> contracts is BUILD-load-bearing: src/server/serve.ts
 *     statically imports @hasna/contracts/auth and secrets' build bundles
 *     it, so secrets' build needs contracts' built dist and declaration
 *     files first.
 * The edge removed is contracts -> secrets: @hasna/contracts now declares
 * @hasna/secrets as a peerDependency (exact 0.3.3 — npm 7+ and bun
 * auto-install peers, so the published runtime path keeps resolving), which
 * takes that edge out of turbo's package graph while leaving the load-bearing
 * secrets -> contracts devDependency edge (and its correct build ordering)
 * untouched.
 *
 * This test is the two-sided gate for that shape:
 *   RED  — the graph is cyclic again and turbo refuses to construct it
 *          (rc != 0), or the secrets -> contracts build edge returns or
 *          disagrees with the installed workspace/registry target, or @hasna/secrets moves back into contracts'
 *          dependencies (the cycle edge);
 *   GREEN — the graph constructs (rc 0) with secrets#build waiting on
 *          contracts#build only when it resolves that workspace; an older
 *          registry pin needs no workspace build. The reverse peer edge is absent.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { APPS_DIR, REPO_ROOT } from "./census";

const TURBO_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "turbo");

interface TurboTask {
  taskId: string;
  dependencies: string[];
}

interface TurboDryJson {
  tasks?: TurboTask[];
}

function turboBuildGraph(): { rc: number; tasks: Map<string, string[]>; stderr: string } {
  if (!fs.existsSync(TURBO_BIN)) {
    throw new Error(
      `turbo not installed at ${TURBO_BIN} — the standard suite runs after bun install; a missing turbo binary is a suite defect, not a graph pass`,
    );
  }
  const result = spawnSync(TURBO_BIN, ["run", "build", "--dry=json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
    // The full-workspace dry-run JSON is several MB (task entries for ~80
    // members); the 1 MiB default maxBuffer kills the child with ENOBUFS and
    // reads as rc=-1 — measured, and indistinguishable from a spawn failure.
    maxBuffer: 64 * 1024 * 1024,
  });
  const tasks = new Map<string, string[]>();
  if (result.status === 0 && result.stdout) {
    const parsed = JSON.parse(result.stdout) as TurboDryJson;
    for (const task of parsed.tasks ?? []) {
      tasks.set(task.taskId, task.dependencies ?? []);
    }
  }
  return { rc: result.status ?? -1, tasks, stderr: result.stderr ?? "" };
}

function readMemberManifest(name: string): Record<string, unknown> {
  const manifestPath = path.join(APPS_DIR, name, "package.json");
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("turbo task graph", () => {
  test("the build graph is acyclic (turbo run build --dry=json exits 0)", () => {
    const graph = turboBuildGraph();
    expect(graph.rc, `turbo rc=${graph.rc}\n${graph.stderr}`).toBe(0);
  });

  test("secrets#build follows its resolved Contracts target without a reverse peer edge", () => {
    const graph = turboBuildGraph();
    expect(graph.rc, `turbo rc=${graph.rc}\n${graph.stderr}`).toBe(0);

    const contractsBuild = graph.tasks.get("@hasna/contracts#build");
    const secretsBuild = graph.tasks.get("@hasna/secrets#build");
    expect(contractsBuild, "task @hasna/contracts#build must exist in the dry-run graph").toBeDefined();
    expect(secretsBuild, "task @hasna/secrets#build must exist in the dry-run graph").toBeDefined();

    // A registry pin outside the workspace version (e.g. 0.14.2 vs 1.0.0)
    // consumes the registry artifact, not this checkout's breaking release.
    // Only an actual workspace resolution should create a workspace build edge.
    const resolvedAuth = fs.realpathSync(Bun.resolveSync("@hasna/contracts/auth", path.join(APPS_DIR, "secrets")));
    const workspaceContracts = fs.realpathSync(path.join(APPS_DIR, "contracts"));
    const usesWorkspace = resolvedAuth.startsWith(workspaceContracts + path.sep);
    expect(secretsBuild!.includes("@hasna/contracts#build")).toBe(usesWorkspace);
    // The removed direction: contracts' runtime use of @hasna/secrets is a
    // peerDependency, which turbo 2.5.4 does not traverse — no package-graph
    // cycle, and contracts' build (which deliberately never resolves sibling
    // dist, see src/cli/secrets-bridge.ts) waits on nothing.
    expect(contractsBuild).not.toContain("@hasna/secrets#build");
  });

  test("the dependency classes keep the load-bearing edges in the right direction", () => {
    // contracts' runtime import of @hasna/secrets must be a peerDependency
    // (a move back to dependencies would re-create the package-graph cycle).
    const contracts = readMemberManifest("contracts");
    const peers = (contracts.peerDependencies ?? {}) as Record<string, string>;
    expect(peers["@hasna/secrets"], "@hasna/contracts must declare @hasna/secrets in peerDependencies").toBeDefined();
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      const deps = (contracts[section] ?? {}) as Record<string, string>;
      expect(deps["@hasna/secrets"], `@hasna/contracts must not declare @hasna/secrets in ${section}`).toBeUndefined();
    }

    // secrets' build-time use of @hasna/contracts must be a devDependency
    // (the edge that orders contracts' build first; a peer here would lose
    // that ordering and break secrets' tsc on a fresh install).
    const secrets = readMemberManifest("secrets");
    const devDeps = (secrets.devDependencies ?? {}) as Record<string, string>;
    expect(devDeps["@hasna/contracts"], "@hasna/secrets must declare @hasna/contracts in devDependencies").toBeDefined();
  });
});
