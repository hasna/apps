import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_KIT_VERSION, scanPackedArtifact, scannerCommand } from "../scripts/scan-artifact";

const repoRoot = join(import.meta.dir, "..");
const monorepoRoot = join(repoRoot, "../..");

interface CiStep {
  run?: string;
  if?: unknown;
  "continue-on-error"?: unknown;
  "working-directory"?: unknown;
}
interface CiJob extends Omit<CiStep, "run"> {
  steps?: CiStep[];
  needs?: string | string[];
  env?: Record<string, unknown>;
  strategy?: { matrix?: unknown; "fail-fast"?: unknown };
}
interface RootCi { jobs?: Record<string, CiJob> }

function rootCi(): RootCi {
  return Bun.YAML.parse(readFileSync(join(monorepoRoot, ".github/workflows/ci.yml"), "utf8")) as RootCi;
}

/** The nested standalone-era workflow is not a GitHub Actions entry point. */
function rootCiViolations(workflow: RootCi): string[] {
  const violations: string[] = [];
  const always = "${{ always() }}";
  const stepIndex = (jobName: string, command: string, requiredIf?: string) => {
    const job = workflow.jobs?.[jobName];
    const index = job?.steps?.findIndex((step) => step.run?.split("\n").some((line) => line.trim() === command)) ?? -1;
    const step = job?.steps?.[index];
    if (!job || !step || [job, step].some((entry) => entry.if !== requiredIf ||
      (entry["continue-on-error"] !== undefined && entry["continue-on-error"] !== false) ||
      entry["working-directory"] !== undefined)) {
      violations.push(`${jobName}: missing hard root command ${command}`);
    }
    return index;
  };
  // A frozen plan feeds isolated serial runners; the required aggregate must
  // execute even when a shard fails and reject missing/failed terminal receipts.
  stepIndex("affected-plan", 'bun tooling/ci/run-affected-shards.ts plan "$RUNNER_TEMP/affected-plan"');
  stepIndex("affected-shard", 'bun tooling/ci/run-affected-shards.ts shard "$RUNNER_TEMP/affected-plan/plan.json" "$AFFECTED_PLAN_SHA256" "$AFFECTED_SHARD" "$RUNNER_TEMP/affected-shard"');
  stepIndex("build-test", 'bun tooling/ci/run-affected-shards.ts aggregate "$RUNNER_TEMP/affected-plan/plan.json" "$AFFECTED_PLAN_SHA256" "$RUNNER_TEMP/affected-receipts" "$AFFECTED_MATRIX_RESULT" "$RUNNER_TEMP/affected-aggregate.json"', always);
  const shard = workflow.jobs?.["affected-shard"];
  const aggregate = workflow.jobs?.["build-test"];
  const needs = (job?: CiJob) => typeof job?.needs === "string" ? [job.needs] : job?.needs ?? [];
  const equal = (value: unknown, expected: unknown, message: string) => {
    if (JSON.stringify(value) !== JSON.stringify(expected)) violations.push(message);
  };
  equal(needs(shard), ["affected-plan"], "shards must depend on the frozen plan");
  equal([...needs(aggregate)].sort(), ["affected-plan", "affected-shard"], "aggregate must depend on planner and all shards");
  equal(shard?.strategy?.matrix, "${{ fromJSON(needs.affected-plan.outputs.matrix) }}", "all planned shards must execute");
  equal(shard?.strategy?.["fail-fast"], false, "a failed shard must not cancel other planned tests");
  for (const job of [shard, aggregate]) {
    equal(job?.env?.AFFECTED_PLAN_SHA256, "${{ needs.affected-plan.outputs.plan-sha256 }}", "execution must bind the frozen plan digest");
  }
  equal(shard?.env?.AFFECTED_SHARD, "${{ matrix.shard }}", "each runner must execute its selected shard");
  equal(aggregate?.env?.AFFECTED_MATRIX_RESULT, "${{ needs.affected-shard.result }}", "aggregate must receive the actual shard result");
  stepIndex("gates", "bun tooling/ci/check-manifests.ts --self-test");
  stepIndex("gates", "bun tooling/ci/check-manifests.ts");
  stepIndex("publish-guard", "bun tooling/ci/check-publish-guard.ts --self-test");
  stepIndex("publish-guard", "bun tooling/ci/check-publish-guard.ts");
  return violations;
}

function readText(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(readText(relativePath));
}

/** Strip comments so a doc line naming an env API cannot mask a real read of it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * Scripts reachable from `entry` through the pre/post lifecycle and `bun run` /
 * `npm run` references. Mirrors the graph `contracts repo-conformance` walks for
 * its published_artifact_gate check, so the wiring is proven on every `bun test`
 * and not only when someone remembers to type the conformance CLI.
 */
function scriptsReachedBy(scripts: Record<string, string>, entry: string): Set<string> {
  const reached = new Set<string>();
  const queue: string[] = [entry];
  const enqueue = (name: string | undefined) => {
    if (name && name in scripts) queue.push(name);
  };
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (reached.has(name)) continue;
    reached.add(name);
    enqueue(`pre${name}`);
    enqueue(`post${name}`);
    const body = scripts[name];
    if (!body) continue;
    for (const match of body.matchAll(
      /\b(?:bun|bunx|npm|pnpm|yarn)\s+(?:(?:--\S+|-\w)\s+)*(?:run\s+)?([a-zA-Z0-9_][\w:.-]*)/g,
    )) {
      enqueue(match[1]);
    }
  }
  return reached;
}

/** Every `bunx`/`npx` spec in a script body that carries no @version pin. */
function unpinnedRunnerInvocations(body: string): string[] {
  const unpinned: string[] = [];
  for (const segment of body.split(/&&|\|\||;/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    for (const [index, token] of tokens.entries()) {
      if (token !== "bunx" && token !== "npx") continue;
      const spec = tokens.slice(index + 1).find((candidate) => !candidate.startsWith("-"));
      if (spec === undefined) continue;
      if (spec.indexOf("@", spec.startsWith("@") ? 1 : 0) === -1) unpinned.push(`${token} ${spec}`);
      break;
    }
  }
  return unpinned;
}

describe("hasna.contract.json", () => {
  test("is a hasna.service_contract.v1 document, not an invented shape", () => {
    // The first manifest landed with `schema_version`/`package`/`kind` and a
    // `storage.waived` flag, none of which exist in the schema; every later
    // conformance gate is unobservable while manifest_valid fails.
    const manifest = readJson("hasna.contract.json");

    expect(manifest.schema).toBe("hasna.service_contract.v1");
    expect(manifest.contractVersion).toBe("v1");
    expect(manifest.class).toBe("library");
    expect(manifest.kitVersion).toBe(CONTRACTS_KIT_VERSION);
    expect(manifest.hosting).toContain("user-hosted");
    for (const invented of ["schema_version", "package", "kind"]) {
      expect(manifest).not.toHaveProperty(invented);
    }
    // A library owns no store, so it declares no storage block at all rather
    // than a waiver key the schema rejects.
    expect(manifest.storage).toBeUndefined();
  });

  test("declares exactly the allowlisted bins package.json ships", () => {
    // repo-conformance fails both ways: a bin outside `<name>[-suffix]` is not
    // allowlisted, and a package.json bin the manifest omits is undeclared.
    const manifest = readJson("hasna.contract.json");
    const packageBins = Object.keys(readJson("package.json").bin as Record<string, string>);
    const allowed = ["", "-cli", "-mcp", "-serve", "-worker", "-runner", "-daemon", "-migrate", "-doctor"].map(
      (suffix) => `${manifest.name}${suffix}`,
    );

    expect(manifest.bins).toEqual(packageBins);
    for (const bin of manifest.bins as string[]) {
      expect(allowed).toContain(bin);
    }
  });

  test("binds every supported surface to something package.json actually exports", () => {
    const manifest = readJson("hasna.contract.json");
    const pkg = readJson("package.json");
    const surfaces = manifest.serviceSurfaces as Record<string, any>[];
    const kinds = surfaces.filter((surface) => surface.status === "supported").map((surface) => surface.kind);
    const waived = ((manifest.metadata?.conformance?.waivedSurfaces ?? []) as Record<string, any>[]).map(
      (waiver) => waiver.kind,
    );

    // api and mcp are waivable for a library; sdk and cli have to be real.
    for (const kind of ["api", "sdk", "mcp", "cli"]) {
      expect([...kinds, ...waived]).toContain(kind);
    }
    for (const surface of surfaces) {
      if (surface.bin) expect(Object.keys(pkg.bin)).toContain(surface.bin);
      if (surface.kind === "sdk") expect(Object.keys(pkg.exports)).toContain(surface.exportSubpath);
    }
  });
});

describe("scan:artifact release gate", () => {
  test("resolves the pinned scanner from source alone — the module reads no environment", () => {
    // A gate whose command can be swapped at publish time is not a gate.
    const source = stripComments(readText("scripts/scan-artifact.ts"));
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/Bun\.env/);
    expect(source).not.toMatch(/import\.meta\.env/);

    expect(scannerCommand("/tmp/pkg.tgz")).toEqual([
      "bunx",
      `@hasna/contracts@${CONTRACTS_KIT_VERSION}`,
      "artifact-scan",
      "/tmp/pkg.tgz",
    ]);
  });

  test("keeps prepack and prepublishOnly wired to the declared packed-artifact scan", () => {
    // published_artifact_gate reads the declared script name off the manifest,
    // then requires prepack to reach it. The deliverable is the wiring.
    const scripts = readJson("package.json").scripts as Record<string, string>;
    const declared = readJson("hasna.contract.json").metadata?.release?.artifactScan?.script;

    expect(declared).toBe("scan:artifact");
    expect(scripts[declared]).toBe("bun scripts/scan-artifact.ts");
    for (const entry of ["prepack", "prepublishOnly"]) {
      expect(scripts[entry]).toBeString();
      expect([...scriptsReachedBy(scripts, entry)]).toContain(declared);
    }
  });

  test("pins every package-runner invocation in package.json scripts", () => {
    // CONTRACT.md Clause C fails the gate on an unpinned invocation, and an
    // unpinned kit means the gate that passed today can fail tomorrow.
    const scripts = readJson("package.json").scripts as Record<string, string>;
    for (const [name, body] of Object.entries(scripts)) {
      expect(unpinnedRunnerInvocations(body), `${name}: ${body}`).toEqual([]);
    }
    expect(scripts["contract-check"]).toBe(
      `bunx @hasna/contracts@${CONTRACTS_KIT_VERSION} repo-conformance .`,
    );
  });

  test("uses the active root CI build/test, manifest and npm publish-guard lanes", () => {
    // Package tests below execute the pinned artifact scan and real npm prepack.
    // Turbo builds this workspace member before running those tests. The root
    // manifest lane also runs conformance; its reporting policy is not changed.
    const rootPackage = JSON.parse(readFileSync(join(monorepoRoot, "package.json"), "utf8"));
    const turbo = JSON.parse(readFileSync(join(monorepoRoot, "turbo.json"), "utf8"));
    expect(rootPackage.workspaces).toContain("apps/*");
    expect(readJson("package.json").scripts.test).toBe("bun test");
    expect(turbo.tasks.test.dependsOn).toContain("build");
    expect(turbo.tasks.build.outputs).toContain("dist/**");
    expect(rootCiViolations(rootCi())).toEqual([]);
  });

  test("root CI coverage checks reject missing, skipped and softened lanes", () => {
    for (const jobName of ["affected-plan", "affected-shard", "build-test", "gates", "publish-guard"]) {
      const missing = rootCi();
      delete missing.jobs![jobName];
      expect(rootCiViolations(missing).length).toBeGreaterThan(0);
      for (const field of ["if", "continue-on-error"] as const) {
        const softened = rootCi();
        softened.jobs![jobName]![field] = field === "if" ? false : true;
        expect(rootCiViolations(softened).length).toBeGreaterThan(0);
      }
    }
    for (const jobName of ["affected-plan", "affected-shard", "build-test", "gates", "publish-guard"]) {
      const original = rootCi();
      const steps = original.jobs![jobName]!.steps!;
      for (const [index, step] of steps.entries()) {
        if (!step.run?.match(/bun tooling\/ci\/run-affected-shards\.ts (plan|shard|aggregate)|bun tooling\/ci\/check-(manifests|publish-guard)\.ts(?: --self-test)?(?:\n|$)/)) continue;
        for (const mutation of ["commented", "conditional", "softened"] as const) {
          const changed = structuredClone(original);
          const target = changed.jobs![jobName]!.steps![index]!;
          if (mutation === "commented") target.run = target.run!.split("\n").map((line) => `# ${line}`).join("\n");
          if (mutation === "conditional") target.if = false;
          if (mutation === "softened") target["continue-on-error"] = true;
          expect(rootCiViolations(changed).length).toBeGreaterThan(0);
        }
      }
    }
    for (const mutation of [
      (ci: RootCi) => { ci.jobs!["affected-shard"]!.needs = []; },
      (ci: RootCi) => { ci.jobs!["build-test"]!.needs = ["affected-plan"]; },
      (ci: RootCi) => { ci.jobs!["affected-shard"]!.strategy!.matrix = { shard: [0] }; },
      (ci: RootCi) => { ci.jobs!["affected-shard"]!.strategy!["fail-fast"] = true; },
      (ci: RootCi) => { ci.jobs!["affected-shard"]!.env!.AFFECTED_SHARD = "0"; },
      (ci: RootCi) => { ci.jobs!["affected-shard"]!.env!.AFFECTED_PLAN_SHA256 = "unbound"; },
      (ci: RootCi) => { ci.jobs!["build-test"]!.env!.AFFECTED_PLAN_SHA256 = "unbound"; },
      (ci: RootCi) => { ci.jobs!["build-test"]!.env!.AFFECTED_MATRIX_RESULT = "success"; },
      (ci: RootCi) => { delete ci.jobs!["build-test"]!.if; },
    ]) {
      const changed = rootCi(); mutation(changed);
      expect(rootCiViolations(changed).length).toBeGreaterThan(0);
    }
  });

  test("packs the artifact and passes the scan with the pinned kit", () => {
    // Proves the pin actually resolves on the registry: an unpublished version
    // makes bunx exit 1 here, exactly as it would in prepack.
    const { command, output } = scanPackedArtifact();
    expect(command[1]).toBe(`@hasna/contracts@${CONTRACTS_KIT_VERSION}`);
    expect(output).toContain("pass artifact-scan");
  }, 300_000);

  test("leaves the package packable through the real prepack lifecycle", () => {
    // The gate has to run from prepack without breaking the thing it guards.
    // A prepack that exits non-zero makes the package impossible to pack or
    // publish. The outer dry-run must still scan a real inner npm archive.
    const result = Bun.spawnSync(["npm", "pack", ".", "--dry-run", "--json", "--workspaces=false"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const combined = [result.stdout, result.stderr].map((buffer) => new TextDecoder().decode(buffer)).join("\n");

    expect(combined).not.toContain('script "prepack" exited with code');
    expect(result.exitCode, combined).toBe(0);
    expect(combined).toContain("pass artifact-scan");
  }, 300_000);
});
