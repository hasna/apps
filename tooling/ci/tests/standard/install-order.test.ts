/**
 * Install ordering — standard-adherence suite, check 6.
 *
 * bun install runs workspace member prepare scripts CONCURRENTLY with no
 * topological ordering (measured on bun 1.3.14, 2026-08-21, controlled
 * two-package experiment: prepare bodies overlapped despite a dependency
 * edge). In this workspace @hasna/machines' prepare-time `tsc` reads
 * @hasna/contracts/dist while contracts' own prepare is mid-rebuild
 * (rm -rf dist -> .js -> .d.ts) and fails with TS7016 "Could not find a
 * declaration file for module '@hasna/contracts/...'" — root CI red 5/5
 * (todos 3b2a7f1e, runs 32450633417 / 32450042833 / 32451644347).
 *
 * The task-graph edge cannot be expressed to bun's install runner, so it is
 * declared in the root package.json `prepare:ordered` chain — a deterministic
 * topological order of prepare members and their workspace build dependencies.
 * Every CI `Install` step runs the build phase through that chain (after a scriptless `bun install --frozen-lockfile
 * --ignore-scripts`), never through a bare scriptful install that bun
 * schedules unordered.
 *
 * Three assertions:
 *   CENSUS   — `prepare:ordered` names EXACTLY the prepare members and their
 *              transitive workspace build dependencies. A dependency without
 *              prepare still needs its dist on a clean checkout (Skills now
 *              bundles the Secrets SDK, which has no prepare script).
 *   ORDER    — every workspace build dependency precedes its consumer.
 *   CI SHAPE — every `Install` step in .github/workflows/ci.yml runs
 *              `bun install --frozen-lockfile --ignore-scripts` and
 *              `bun run prepare:ordered`; a bare scriptful
 *              `bun install --frozen-lockfile` anywhere in an Install step is
 *              a violation.
 *
 * The two-sided self-tests reject missing prerequisite SDKs, reversed edges,
 * unrelated build members, duplicate entries and bare scriptful installs,
 * while accepting the complete ordered chain.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { REPO_ROOT } from "./census";

const ROOT_PKG_PATH = path.join(REPO_ROOT, "package.json");
const CI_YML_PATH = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");

/**
 * Parse the root package.json `prepare:ordered` script into the ordered list
 * of member package names it builds. The chain is a sequence of
 * `bun run --filter @hasna/<name> build` segments joined with `&&`.
 */
export function orderedPrepareMembers(rootPkgJson: unknown): string[] {
  const scripts = (rootPkgJson as { scripts?: Record<string, string> }).scripts ?? {};
  const chain = scripts["prepare:ordered"];
  if (!chain) return [];
  const out: string[] = [];
  for (const segment of chain.split("&&")) {
    const m = segment.match(/--filter\s+(@hasna\/[a-z0-9-]+)\s+build/);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Members (directory names) that declare a `prepare` script.
 */
export function prepareScriptMembers(appsDir: string): string[] {
  const out: string[] = [];
  for (const dir of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgPath = path.join(appsDir, dir.name, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    if (pkg.scripts?.prepare !== undefined) out.push(dir.name);
  }
  return out;
}

/** Workspace build dependency closure, rooted only at prepare members. */
export function prepareBuildGraph(appsDir: string): Map<string, string[]> {
  type Package = {
    name: string;
    version: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const packages = new Map<string, Package>();
  for (const dir of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = path.join(appsDir, dir.name, "package.json");
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as Package;
    packages.set(pkg.name, pkg);
  }
  const graph = new Map<string, string[]>();
  function visit(name: string): void {
    if (graph.has(name)) return;
    const pkg = packages.get(name)!;
    const deps = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies })
      .filter(([dep, spec]) => {
        const target = packages.get(dep);
        if (target?.scripts?.build === undefined) return false;
        // URL/tarball pins and nonmatching registry versions are not workspace
        // edges. Contracts deliberately consumes the published Secrets archive.
        if (["workspace:*", "workspace:^", "workspace:~"].includes(spec)) return true;
        const range = spec.replace(/^workspace:/, "").trim();
        if (/[:/\\]/.test(range) || !/^(?:[0-9*^~<>=xX]|v[0-9])/.test(range)) return false;
        return Bun.semver.satisfies(target.version, range);
      })
      .map(([dep]) => dep);
    graph.set(name, deps);
    for (const dep of deps) visit(dep);
  }
  for (const [name, pkg] of packages) {
    if (pkg.scripts?.prepare !== undefined) visit(name);
  }
  return graph;
}

export function prepareBuildViolations(chain: string[], graph: Map<string, string[]>): string[] {
  const problems: string[] = [];
  for (const [name, deps] of graph) {
    if (!chain.includes(name)) problems.push(`${name} is required by prepare but missing from the build chain`);
    for (const dep of deps) {
      if (chain.includes(name) && chain.includes(dep) && chain.indexOf(dep) >= chain.indexOf(name)) {
        problems.push(`${dep} must build before ${name}`);
      }
    }
  }
  for (const [i, name] of chain.entries()) {
    if (!graph.has(name)) problems.push(`${name} is not a prepare member or a required workspace build dependency`);
    if (chain.indexOf(name) !== i) problems.push(`${name} appears more than once in the build chain`);
  }
  return problems;
}

/**
 * Parse the root package.json `prepare:ordered` script into the ordered list
 * of member package names whose postinstall it runs. These are postinstall
 * scripts that install nested dependencies (gate-load-bearing: without them a
 * scriptless install leaves a build missing its tools); the chain must carry
 * them as `bun run --filter @hasna/<name> postinstall` segments.
 */
export function orderedPostinstallMembers(rootPkgJson: unknown): string[] {
  const scripts = (rootPkgJson as { scripts?: Record<string, string> }).scripts ?? {};
  const chain = scripts["prepare:ordered"];
  if (!chain) return [];
  const out: string[] = [];
  for (const segment of chain.split("&&")) {
    const m = segment.match(/--filter\s+(@hasna\/[a-z0-9-]+)\s+postinstall/);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Members whose postinstall script installs nested dependencies — measured to
 * be gate-load-bearing under the scriptless CI install: @hasna/connectors'
 * postinstall runs `cd dashboard && bun install` for its non-workspace
 * dashboard package, and the turbo build fails with `vite: command not found`
 * when it is skipped. Detection: the postinstall body invokes a package
 * installer (`bun install` / `npm install`). Pure data-dir creation
 * (mkdir/install -d/chmod/node fs.mkdirSync) is not gate-load-bearing and
 * must NOT be forced into the chain.
 */
export function dependencyInstallingPostinstallMembers(appsDir: string): string[] {
  const out: string[] = [];
  for (const dir of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgPath = path.join(appsDir, dir.name, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    const postinstall = pkg.scripts?.postinstall;
    if (postinstall !== undefined && /\b(bun|npm|pnpm|yarn)\s+install\b/.test(postinstall)) out.push(dir.name);
  }
  return out;
}

/**
 * CI Install-step violations: every `- name: Install` block's `run:` body must
 * run the scriptless install AND the ordered prepare chain. A bare scriptful
 * `bun install --frozen-lockfile` is the unordered-scheduling defect.
 */
export function ciInstallViolations(ciYml: string): string[] {
  const out: string[] = [];
  const blocks = ciYml.split(/- name: Install\n/).slice(1);
  if (blocks.length === 0) {
    out.push("ci.yml has no `- name: Install` step");
    return out;
  }
  for (let i = 0; i < blocks.length; i++) {
    const runMatch = blocks[i].match(/run:\s*([^\n]+(?:\n[ \t]+[^\n]+)*)/);
    const run = runMatch ? runMatch[1].replace(/\n[ \t]+/g, " ") : "";
    if (!run.includes("--ignore-scripts")) {
      out.push(`Install step ${i + 1}: run body lacks '--ignore-scripts' (scripts must not run unordered): ${run}`);
    }
    if (!run.includes("prepare:ordered")) {
      out.push(`Install step ${i + 1}: run body lacks 'prepare:ordered' (the declared task-graph edge): ${run}`);
    }
  }
  return out;
}

describe("standard-adherence: install ordering", () => {
  test("prepare:ordered builds the complete workspace dependency closure before its consumers", () => {
    const rootPkg = JSON.parse(fs.readFileSync(ROOT_PKG_PATH, "utf8"));
    const chain = orderedPrepareMembers(rootPkg);
    const graph = prepareBuildGraph(path.join(REPO_ROOT, "apps"));
    const problems = prepareBuildViolations(chain, graph);
    expect(problems, `install-ordering violations:\n${problems.join("\n")}`).toEqual([]);
    expect(chain.length, "prepare:ordered chain must not be empty").toBeGreaterThan(0);
  });

  test("dependency census includes SDKs without prepare, recursively, and rejects omissions, inversions and extras", () => {
    const appsDir = fs.mkdtempSync(path.join(tmpdir(), "prepare-order-"));
    try {
      for (const [name, extra] of Object.entries({
        skills: { scripts: { prepare: "bun run build", build: "build" }, devDependencies: { "@hasna/secrets": "1.0.0" } },
        secrets: { dependencies: { "@hasna/contracts": "1.0.0", "external-package": "1.0.0" } },
        contracts: { devDependencies: { "@hasna/secrets": "https://registry.npmjs.org/@hasna/secrets/-/secrets-1.0.0.tgz", "@hasna/unrelated": "^2.0.0" } },
        unrelated: {},
      })) {
        const dir = path.join(appsDir, name);
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: `@hasna/${name}`, version: "1.0.0", scripts: { build: "build" }, ...extra }));
      }
      const graph = prepareBuildGraph(appsDir);
      expect([...graph.keys()].sort()).toEqual(["@hasna/contracts", "@hasna/secrets", "@hasna/skills"]);
      expect(prepareScriptMembers(appsDir)).toEqual(["skills"]);
      const good = ["@hasna/contracts", "@hasna/secrets", "@hasna/skills"];
      expect(prepareBuildViolations(good, graph)).toEqual([]);
      expect(prepareBuildViolations(["@hasna/skills"], graph)).toContain("@hasna/secrets is required by prepare but missing from the build chain");
      expect(prepareBuildViolations([...good].reverse(), graph)).toContain("@hasna/secrets must build before @hasna/skills");
      expect(prepareBuildViolations([...good, "@hasna/unrelated"], graph)).toHaveLength(1);
      expect(prepareBuildViolations([...good, "@hasna/skills"], graph)).toHaveLength(1);
    } finally {
      fs.rmSync(appsDir, { recursive: true, force: true });
    }
  });

  test("every CI Install step runs the scriptless install then the ordered chain", () => {
    const ciYml = fs.readFileSync(CI_YML_PATH, "utf8");
    const violations = ciInstallViolations(ciYml);
    expect(violations, `install-ordering violations:\n${violations.join("\n")}`).toEqual([]);
  });

  test("prepare:ordered runs the postinstall of every member whose postinstall installs nested dependencies", () => {
    const rootPkg = JSON.parse(fs.readFileSync(ROOT_PKG_PATH, "utf8"));
    const chainPostinstall = orderedPostinstallMembers(rootPkg);
    const gateLoadBearing = dependencyInstallingPostinstallMembers(path.join(REPO_ROOT, "apps")).map(
      (n) => `@hasna/${n}`,
    );
    const missing = gateLoadBearing.filter((p) => !chainPostinstall.includes(p));
    expect(missing, `postinstall-gap violations:\n${missing.join("\n")}`).toEqual([]);
  });

  test("self-test: the checks fire on the defect shapes and stay silent on the compliant shapes", () => {
    const brokenChain = JSON.stringify({
      scripts: {
        "prepare:ordered":
          "bun run --filter @hasna/machines build && bun run --filter @hasna/contracts build",
      },
    });
    const brokenOrder = orderedPrepareMembers(JSON.parse(brokenChain));
    expect(brokenOrder).toEqual(["@hasna/machines", "@hasna/contracts"]);

    const goodChain = JSON.stringify({
      scripts: {
        "prepare:ordered":
          "bun run --filter @hasna/contracts build && bun run --filter @hasna/machines build",
      },
    });
    expect(orderedPrepareMembers(JSON.parse(goodChain))).toEqual(["@hasna/contracts", "@hasna/machines"]);

    const bareInstall =
      "  jobs:\n" +
      "    gates:\n" +
      "      steps:\n" +
      "        - name: Install\n" +
      "          run: bun install --frozen-lockfile\n";
    const fixedInstall =
      "  jobs:\n" +
      "    gates:\n" +
      "      steps:\n" +
      "        - name: Install\n" +
      "          run: |\n" +
      "            bun install --frozen-lockfile --ignore-scripts\n" +
      "            bun run prepare:ordered\n";
    const bare = ciInstallViolations(bareInstall);
    const fixed = ciInstallViolations(fixedInstall);
    expect(bare.length, `bare scriptful install must be a violation:\n${bare.join("\n")}`).toBeGreaterThan(0);
    expect(fixed, `compliant Install step must be silent:\n${fixed.join("\n")}`).toEqual([]);

    const noPostinstallStep = JSON.stringify({
      scripts: { "prepare:ordered": "bun run --filter @hasna/contracts build" },
    });
    const withPostinstallStep = JSON.stringify({
      scripts: {
        "prepare:ordered":
          "bun run --filter @hasna/contracts build && bun run --filter @hasna/connectors postinstall",
      },
    });
    expect(orderedPostinstallMembers(JSON.parse(noPostinstallStep))).toEqual([]);
    expect(orderedPostinstallMembers(JSON.parse(withPostinstallStep))).toEqual(["@hasna/connectors"]);
  });

});
