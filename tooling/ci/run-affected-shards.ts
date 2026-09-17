import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { aggregate, canonical, dependencyClosure, hash, insist, makePlan, parseDryRun, sameGraph, TOOLCHAIN, validateManifest, validatePlan, verifySummary,
  type Context, type Phase, type Plan, type Receipt, type Task, type Timing } from "./affected-shards";

const root = process.cwd();
async function command(argv: string[], env: Record<string, string | undefined> = {}, capture = true): Promise<{ code: number; stdout: string }> {
  const child = Bun.spawn(argv, { cwd: root, env: { ...process.env, ...env }, stdin: "ignore", stdout: capture ? "pipe" : "inherit", stderr: "inherit" });
  const stdout = capture ? await new Response(child.stdout as ReadableStream).text() : "";
  return { code: await child.exited, stdout };
}
async function checked(argv: string[]): Promise<string> { const out = await command(argv); insist(out.code === 0, `Command failed: ${argv[0]}`); return out.stdout.trim(); }
async function actualIdentity(base: string): Promise<Pick<Context, "repository" | "runId" | "runAttempt" | "head" | "tree" | "base" | "lockSha256">> {
  const head = await checked(["git", "rev-parse", "HEAD"]), tree = await checked(["git", "rev-parse", "HEAD^{tree}"]);
  insist(head === process.env.GITHUB_SHA, "Actual checkout differs from workflow SHA");
  insist(await checked(["git", "rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]) === base, "Base is not the resolved immutable commit");
  return { repository: process.env.GITHUB_REPOSITORY!, runId: process.env.GITHUB_RUN_ID!, runAttempt: process.env.GITHUB_RUN_ATTEMPT!, head, tree, base, lockSha256: hash(readFileSync("bun.lock")) };
}
async function pinnedToolchain(): Promise<typeof TOOLCHAIN> {
  insist(Bun.version === TOOLCHAIN.bun, "Wrong Bun executable");
  insist(await checked(["npm", "--version"]) === TOOLCHAIN.npm, "Wrong npm executable");
  insist(await checked([join(root, "node_modules/.bin/turbo"), "--version"]) === TOOLCHAIN.turbo, "Wrong Turbo executable"); return TOOLCHAIN;
}
function validateManifests(graph: Task[]): void {
  for (const task of graph) {
    const directory = realpathSync(join(root, task.directory)); insist(relative(root, directory) === task.directory, "Workspace escapes checkout");
    validateManifest(task, JSON.parse(readFileSync(join(directory, "package.json"), "utf8")));
  }
}
function writeJson(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + "\n"); }
function envFor(plan: Pick<Plan, "context">) { return { TURBO_SCM_BASE: plan.context.base, TURBO_SCM_HEAD: plan.context.head, TURBO_TELEMETRY_DISABLED: "1" }; }
// `--affected` is derived ONCE, in the plan job. Turbo 2.5.4 attributes a changed file under the nested
// workspace apps/notes/server to the parent or the child at random (HashMap order: 7 of 10 identical
// dry-runs on one tree included notes-server, 3 did not), so a shard that re-derives `--affected`
// disagrees with its own plan about a third of the time and refuses with "graph differs". Selecting the
// plan's packages by name is deterministic (5/5 identical) and is still verified against the frozen graph.
function packageFilters(graph: Task[]): string[] { return [...new Set(graph.map(t => t.package))].sort().map(name => `--filter=${name}`); }
async function dry(targets: string[], plan: Pick<Plan, "context">, path: string): Promise<Task[]> {
  const out = await command([join(root, "node_modules/.bin/turbo"), "run", ...targets, "--dry=json", "--concurrency=1", "--env-mode=strict"], envFor(plan));
  writeFileSync(path, out.stdout); insist(out.code === 0, "Turbo dry-run failed");
  const graph = parseDryRun(JSON.parse(out.stdout), plan.context.head); validateManifests(graph); return graph;
}
function readPlan(path: string, expectedSha: string): Plan {
  insist(/^[a-f0-9]{64}$/.test(expectedSha), "Missing expected plan SHA256");
  const bytes = readFileSync(path); insist(hash(bytes) === expectedSha, "Plan artifact changed"); return validatePlan(JSON.parse(bytes.toString()));
}
async function plan(out: string): Promise<void> {
  mkdirSync(out, { recursive: true }); let ref: string;
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    insist(process.env.GITHUB_BASE_REF, "Missing PR base ref"); await checked(["git", "check-ref-format", "--branch", process.env.GITHUB_BASE_REF]); ref = `origin/${process.env.GITHUB_BASE_REF}`;
  } else {
    insist(process.env.GITHUB_EVENT_NAME === "push", "Unsupported affected-base event");
    ref = (await command(["git", "rev-parse", "--verify", "-q", "HEAD^"])).code === 0 ? "HEAD^" : "HEAD";
  }
  const base = await checked(["git", "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  const context: Context = { ...await actualIdentity(base), toolchain: await pinnedToolchain() };
  const buildGraph = await dry(["build", "--affected"], { context }, join(out, "build-dry.json"));
  const testGraph = await dry(["test", "--affected"], { context }, join(out, "test-dry.json"));
  const timing: Timing = JSON.parse(readFileSync(join(root, "tooling/ci/affected-test-durations.json"), "utf8"));
  const frozen = makePlan(context, buildGraph, testGraph, timing); writeJson(join(out, "plan.json"), frozen);
  const sha = hash(readFileSync(join(out, "plan.json")));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `head=${context.head}\nbase=${base}\nplan-sha256=${sha}\nmatrix=${JSON.stringify({ shard: frozen.shards.map(s => s.id) })}\n`);
  console.log(JSON.stringify({ head: context.head, base, planSha256: sha, shards: frozen.shards, noCommandBuildNodes: buildGraph.filter(t => t.command === null).map(t => t.taskId) }));
}
async function executePhase(name: "build" | "test", targets: string[], graph: Task[], plan: Plan, out: string, cache: string, allowCachedBuilds: ReadonlySet<string>): Promise<Phase> {
  if (!graph.some(t => t.command !== null)) return { status: "noop", graph, executed: [], summarySha256: null };
  const summaryDir = join(root, ".turbo/runs"), before = new Set(existsSync(summaryDir) ? readdirSync(summaryDir) : []);
  const result = await command([join(root, "node_modules/.bin/turbo"), "run", ...targets, "--concurrency=1", "--env-mode=strict", "--cache=local:rw", `--cache-dir=${cache}`, "--summarize"], envFor(plan), false);
  const summaries = existsSync(summaryDir) ? readdirSync(summaryDir).filter(f => f.endsWith(".json") && !before.has(f)) : [];
  insist(summaries.length === 1, "Expected exactly one new terminal Turbo summary");
  const summaryPath = join(out, `${name}-summary.json`); copyFileSync(join(summaryDir, summaries[0]!), summaryPath);
  insist(result.code === 0, `${name} task execution failed`);
  const executed = verifySummary(JSON.parse(readFileSync(summaryPath, "utf8")), graph, plan.context.head, allowCachedBuilds);
  return { status: "passed", graph, executed, summarySha256: hash(readFileSync(summaryPath)) };
}
async function shard(path: string, expectedSha: string, shardId: string, out: string): Promise<void> {
  mkdirSync(out, { recursive: true }); const frozen = readPlan(path, expectedSha);
  insist(/^[0-3]$/.test(shardId), "Unknown shard index"); const id = Number(shardId);
  const receipt: Receipt = { schemaVersion: 1, context: frozen.context, planSha256: expectedSha, shard: id, status: "failed", assignedTests: frozen.shards[id]!.tests };
  try {
    const actual = { ...await actualIdentity(frozen.context.base), toolchain: await pinnedToolchain() }; insist(canonical(actual) === canonical(frozen.context), "Foreign shard checkout, base, run, or lockfile");
    // An empty plan has no packages to name; re-deriving `--affected` is deterministic there (a nested-
    // workspace change always makes its parent affected too, so the ambiguity never yields an empty set).
    const buildTargets = frozen.buildGraph.length ? ["build", ...packageFilters(frozen.buildGraph)] : ["build", "--affected"];
    sameGraph(await dry(buildTargets, frozen, join(out, "build-dry.json")), frozen.buildGraph);
    // Never restore a cross-run cache. Only full builds from this owned directory
    // may satisfy later test dependencies; executable test cache hits are refused.
    const cache = mkdtempSync(join(out, "task-cache-"));
    receipt.build = await executePhase("build", buildTargets, frozen.buildGraph, frozen, out, cache, new Set());
    const selected = dependencyClosure(frozen.testGraph, receipt.assignedTests);
    if (receipt.assignedTests.length) sameGraph(await dry(receipt.assignedTests, frozen, join(out, "test-dry.json")), selected);
    else writeJson(join(out, "test-dry.json"), { noExecutableTestTasksAssigned: true, graph: selected });
    receipt.test = await executePhase("test", receipt.assignedTests, selected, frozen, out, cache, new Set(receipt.build.executed.map(t => t.taskId)));
    receipt.status = "passed";
  } catch (error) { receipt.problem = error instanceof Error ? error.message : "Shard failed"; throw error; }
  finally { writeJson(join(out, "receipt.json"), receipt); }
}
async function finish(path: string, expectedSha: string, receiptsRoot: string, matrixResult: string, out: string): Promise<void> {
  const frozen = readPlan(path, expectedSha); insist(Bun.version === TOOLCHAIN.bun, "Wrong aggregate Bun");
  const actual = { ...await actualIdentity(frozen.context.base), toolchain: TOOLCHAIN }; insist(canonical(actual) === canonical(frozen.context), "Foreign aggregate checkout or run");
  const files: string[] = [];
  function visit(directory: string) { for (const item of readdirSync(directory, { withFileTypes: true })) { insist(!item.isSymbolicLink(), "Symlinked receipt artifact"); const p = join(directory, item.name); if (item.isDirectory()) visit(p); else if (item.name === "receipt.json") files.push(p); } }
  visit(receiptsRoot);
  const receipts = files.map(p => JSON.parse(readFileSync(p, "utf8")));
  // Bind each summary to its receipt; receipts alone cannot assert success.
  for (let i = 0; i < receipts.length; i++) for (const name of ["build", "test"] as const) {
    const phase = receipts[i][name]; if (phase?.status !== "passed") continue;
    const bytes = readFileSync(join(dirname(files[i]!), `${name}-summary.json`)); insist(hash(bytes) === phase.summarySha256, "Summary artifact changed or missing");
    const buildCache = new Set<string>((receipts[i].build?.executed ?? []).map((t: { taskId: string }) => t.taskId));
    insist(canonical(verifySummary(JSON.parse(bytes.toString()), phase.graph, frozen.context.head, name === "build" ? new Set() : buildCache)) === canonical(phase.executed), "Receipt differs from observed task summary");
  }
  const accepted = aggregate(frozen, expectedSha, receipts, matrixResult);
  writeJson(out, { schemaVersion: 1, status: "passed", context: frozen.context, planSha256: expectedSha, ...accepted }); console.log(JSON.stringify(accepted));
}
if (import.meta.main) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    if (mode === "plan" && args.length === 1) await plan(resolve(args[0]!));
    else if (mode === "shard" && args.length === 4) await shard(resolve(args[0]!), args[1]!, args[2]!, resolve(args[3]!));
    else if (mode === "aggregate" && args.length === 5) await finish(resolve(args[0]!), args[1]!, resolve(args[2]!), args[3]!, resolve(args[4]!));
    else throw Error("Usage: plan <out> | shard <plan> <sha> <0..3> <out> | aggregate <plan> <sha> <receipts> <matrix-result> <out>");
  } catch (error) { console.error(error instanceof Error ? error.message : "Affected CI refused"); process.exitCode = 1; }
}
