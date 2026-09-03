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
 * topological order of the members whose prepare emits dist, with
 * @hasna/contracts first — and every CI `Install` step runs the build phase
 * through that chain (after a scriptless `bun install --frozen-lockfile
 * --ignore-scripts`), never through a bare scriptful install that bun
 * schedules unordered.
 *
 * Three assertions:
 *   CENSUS   — `prepare:ordered` names EXACTLY the members that declare a
 *              prepare script. A new prepare member fails the suite until the
 *              chain gains it (and a stale chain entry is equally a failure).
 *   ORDER    — @hasna/contracts precedes every prepare member that depends on
 *              @hasna/contracts (the measured TS7016 edge: machines, mementos,
 *              attachments, and loops all consume contracts types at
 *              prepare/build time).
 *   CI SHAPE — every `Install` step in .github/workflows/ci.yml runs
 *              `bun install --frozen-lockfile --ignore-scripts` and
 *              `bun run prepare:ordered`; a bare scriptful
 *              `bun install --frozen-lockfile` anywhere in an Install step is
 *              a violation.
 *
 * Plus the suite's two-sided self-test (prove-it-can-fail): a chain missing
 * the contracts-first edge must FIRE, a bare scriptful install step must
 * FIRE, and the compliant shapes must stay SILENT.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, members } from "./census";

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
  test("prepare:ordered names exactly the members with a prepare script (census)", () => {
    const rootPkg = JSON.parse(fs.readFileSync(ROOT_PKG_PATH, "utf8"));
    const chain = orderedPrepareMembers(rootPkg);
    const withPrepare = prepareScriptMembers(path.join(REPO_ROOT, "apps")).map((n) => `@hasna/${n}`);
    const chainSet = new Set(chain);
    const missing = withPrepare.filter((p) => !chainSet.has(p));
    const extra = chain.filter((p) => !withPrepare.includes(p));
    const dupes = chain.filter((p, i) => chain.indexOf(p) !== i);
    const problems = [
      ...missing.map((p) => `${p} has a prepare script but is not in the root prepare:ordered chain`),
      ...extra.map((p) => `${p} is in the root prepare:ordered chain but has no prepare script`),
      ...dupes.map((p) => `${p} appears more than once in the root prepare:ordered chain`),
    ];
    expect(problems, `install-ordering violations:\n${problems.join("\n")}`).toEqual([]);
  });

  test("the chain orders @hasna/contracts before every prepare member that depends on it (the TS7016 edge)", () => {
    const rootPkg = JSON.parse(fs.readFileSync(ROOT_PKG_PATH, "utf8"));
    const chain = orderedPrepareMembers(rootPkg);
    const contractsIndex = chain.indexOf("@hasna/contracts");
    const problems: string[] = [];
    for (const m of members()) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "apps", m.name, "package.json"), "utf8"),
      ) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      if (pkg.scripts?.prepare === undefined) continue;
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      const pkgName = `@hasna/${m.name}`;
      if (deps["@hasna/contracts"] !== undefined && chain.indexOf(pkgName) < contractsIndex) {
        problems.push(
          `${pkgName} consumes @hasna/contracts types at prepare/build time but appears before it in the prepare:ordered chain`,
        );
      }
    }
    expect(problems, `install-ordering violations:\n${problems.join("\n")}`).toEqual([]);
    expect(chain.length, "prepare:ordered chain must not be empty").toBeGreaterThan(0);
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
