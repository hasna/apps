import { createHash } from "node:crypto";

export const TOOLCHAIN = { bun: "1.3.14", npm: "11.19.0", turbo: "2.5.4" } as const;
export const SHARD_COUNT = 4;
export interface Context { repository: string; runId: string; runAttempt: string; head: string; tree: string; base: string; lockSha256: string; toolchain: typeof TOOLCHAIN }
export interface Task { taskId: string; task: "build" | "test"; package: string; directory: string; command: string | null; commandSha256: string | null; dependencies: string[] }
export interface Timing { defaultSeconds: number; estimatesSeconds: Record<string, number> }
export interface Shard { id: number; tests: string[]; estimatedSeconds: number }
export interface Plan { schemaVersion: 1; context: Context; buildGraph: Task[]; testGraph: Task[]; timing: Timing; shards: Shard[] }
export interface Executed { taskId: string; commandSha256: string; cache: "HIT" | "MISS"; startTime: number; endTime: number; exitCode: 0 }
export interface Phase { status: "passed" | "noop"; graph: Task[]; executed: Executed[]; summarySha256: string | null }
export interface Receipt { schemaVersion: 1; context: Context; planSha256: string; shard: number; status: "passed" | "failed"; assignedTests: string[]; build?: Phase; test?: Phase; problem?: string }
type Row = Record<string, any>;
export function insist(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Row)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function record(value: unknown): value is Row { return !!value && typeof value === "object" && !Array.isArray(value); }
const taskPattern = /^@hasna\/[a-z0-9]+(?:-[a-z0-9]+)*#(?:build|test)$/;
function taskId(value: unknown): asserts value is string { insist(typeof value === "string" && taskPattern.test(value), "Invalid package-qualified task ID"); }
function uniqueStrings(value: unknown): string[] { insist(Array.isArray(value) && value.every(v => typeof v === "string"), "Expected string list"); insist(new Set(value).size === value.length, "Duplicate list entry"); return [...value].sort(); }
export function validateContext(value: unknown): asserts value is Context {
  insist(record(value), "Missing context");
  insist(typeof value.repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository), "Invalid repository");
  for (const key of ["runId", "runAttempt"]) insist(typeof value[key] === "string" && /^[1-9][0-9]*$/.test(value[key]), "Invalid run identity");
  for (const key of ["head", "tree", "base"]) insist(typeof value[key] === "string" && /^[a-f0-9]{40}$/.test(value[key]), "Unresolved commit or tree");
  insist(typeof value.lockSha256 === "string" && /^[a-f0-9]{64}$/.test(value.lockSha256), "Invalid lock hash");
  insist(canonical(value.toolchain) === canonical(TOOLCHAIN), "Wrong pinned toolchain");
}
function normalizeTask(value: unknown): Task {
  insist(record(value), "Malformed task"); taskId(value.taskId);
  const [pkg, kind] = value.taskId.split("#");
  insist(value.package === pkg && value.task === kind, "Task identity mismatch");
  insist(typeof value.directory === "string" && /^apps\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(value.directory), "Invalid workspace directory");
  insist(typeof value.command === "string" && value.command.trim().length > 0, "Missing task command");
  const command = value.command === "<NONEXISTENT>" || value.command === "NONEXISTENT" ? null : value.command;
  insist(command !== null || kind === "build", "Only no-command build placeholders are supported");
  const dependencies = uniqueStrings(value.dependencies); dependencies.forEach(taskId);
  return { taskId: value.taskId, package: pkg!, task: kind as Task["task"], directory: value.directory, command,
    commandSha256: command === null ? null : hash(command), dependencies };
}
function validateGraph(tasks: Task[]): void {
  const map = new Map(tasks.map(t => [t.taskId, t])); insist(map.size === tasks.length, "Duplicate task");
  const done = new Set<string>(), active = new Set<string>();
  const visit = (id: string) => {
    insist(map.has(id), `Missing dependency ${id}`); if (done.has(id)) return; insist(!active.has(id), "Dependency cycle"); active.add(id);
    for (const dep of map.get(id)!.dependencies) visit(dep); active.delete(id); done.add(id);
  };
  for (const t of tasks) visit(t.taskId);
}
export function parseDryRun(value: unknown, head: string): Task[] {
  insist(record(value) && value.turboVersion === TOOLCHAIN.turbo && value.envMode === "strict" && value.scm?.sha === head, "Dry run checkout/toolchain mismatch");
  insist(Array.isArray(value.tasks), "Missing dry-run tasks");
  const tasks = value.tasks.map(normalizeTask).sort((a, b) => compare(a.taskId, b.taskId)); validateGraph(tasks); return tasks;
}
export function validateManifest(task: Task, value: unknown): void {
  insist(record(value) && value.name === task.package && record(value.scripts ?? {}), "Malformed workspace manifest");
  const command = value.scripts?.[task.task];
  insist(task.command === null ? command === undefined : command === task.command, `Manifest command mismatch: ${task.taskId}`);
}
function validateTiming(value: Timing): void {
  insist(record(value) && record(value.estimatesSeconds), "Malformed duration estimates");
  for (const n of [value.defaultSeconds, ...Object.values(value.estimatesSeconds)]) insist(typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 86400, "Invalid duration estimate");
  for (const id of Object.keys(value.estimatesSeconds)) taskId(id);
}
export function dependencyClosure(graph: Task[], ids: string[]): Task[] {
  const map = new Map(graph.map(t => [t.taskId, t])), selected = new Set<string>();
  function visit(id: string) { insist(map.has(id), `Unknown task ${id}`); if (selected.has(id)) return; selected.add(id); for (const dep of map.get(id)!.dependencies) visit(dep); }
  ids.forEach(visit); return graph.filter(t => selected.has(t.taskId));
}
export function partition(graph: Task[], timing: Timing): Shard[] {
  validateGraph(graph); validateTiming(timing);
  const tests = graph.filter(t => t.task === "test" && t.command !== null), parents = new Map(tests.map(t => [t.taskId, t.taskId]));
  const parent = (id: string): string => { const p = parents.get(id)!; return p === id ? id : parent(p); };
  // If a future test depends on another test, keep the component on one runner.
  // Turbo expands dependencies once within that invocation, never across shards.
  for (const task of tests) for (const dep of dependencyClosure(graph, [task.taskId]).filter(t => t.task === "test")) {
    const a = parent(task.taskId), b = parent(dep.taskId); if (a !== b) parents.set(a, b);
  }
  const groups = new Map<string, string[]>();
  for (const task of tests) { const root = parent(task.taskId); groups.set(root, [...(groups.get(root) ?? []), task.taskId]); }
  const bins: Shard[] = Array.from({ length: SHARD_COUNT }, (_, id) => ({ id, tests: [], estimatedSeconds: 0 }));
  const bundles = [...groups.values()].map(ids => ({ ids: ids.sort(), seconds: ids.reduce((n, id) => n + (timing.estimatesSeconds[id] ?? timing.defaultSeconds), 0) }))
    .sort((a, b) => b.seconds - a.seconds || compare(a.ids[0]!, b.ids[0]!));
  for (const bundle of bundles) { const bin = [...bins].sort((a, b) => a.estimatedSeconds - b.estimatedSeconds || a.id - b.id)[0]!; bin.tests.push(...bundle.ids); bin.estimatedSeconds += bundle.seconds; }
  for (const bin of bins) bin.tests.sort(); return bins;
}
export function makePlan(context: Context, buildGraph: Task[], testGraph: Task[], timing: Timing): Plan {
  validateContext(context); validateGraph(buildGraph); validateGraph(testGraph);
  insist(buildGraph.every(t => t.task === "build"), "Affected build graph must not execute tests");
  const all = new Map(buildGraph.map(t => [t.taskId, t]));
  for (const task of testGraph) if (all.has(task.taskId)) insist(canonical(all.get(task.taskId)) === canonical(task), "Conflicting graph commands or dependencies");
  return { schemaVersion: 1, context, buildGraph, testGraph, timing, shards: partition(testGraph, timing) };
}
export function validatePlan(value: unknown): Plan {
  insist(record(value) && value.schemaVersion === 1 && Array.isArray(value.buildGraph) && Array.isArray(value.testGraph), "Malformed plan");
  // Reparse normalized graph rows so JSON cannot inject a command hash or task kind.
  const reparse = (rows: Row[]) => rows.map(row => { const task = normalizeTask({ ...row, command: row.command === null ? "NONEXISTENT" : row.command }); insist(canonical(task) === canonical(row), "Malformed normalized task"); return task; });
  const expected = makePlan(value.context, reparse(value.buildGraph), reparse(value.testGraph), value.timing);
  insist(canonical(value) === canonical(expected), "Plan partition is missing, duplicated, changed, or nondeterministic"); return expected;
}
export function sameGraph(actual: Task[], expected: Task[]): void { insist(canonical(actual) === canonical(expected), "Selected task/dependency graph differs from immutable plan"); }
export function verifySummary(value: unknown, graph: Task[], head: string, allowCachedBuilds: ReadonlySet<string>): Executed[] {
  insist(record(value) && value.turboVersion === TOOLCHAIN.turbo && value.envMode === "strict" && value.scm?.sha === head && value.execution?.exitCode === 0, "Failed or foreign Turbo summary");
  insist(Array.isArray(value.tasks), "Missing execution tasks");
  const executable = graph.filter(t => t.command !== null), map = new Map(executable.map(t => [t.taskId, t]));
  insist(value.tasks.length === executable.length && new Set(value.tasks.map((t: Row) => t.taskId)).size === executable.length, "Missing or duplicate executions");
  return value.tasks.map((row: Row) => {
    const expected = map.get(row.taskId); insist(expected, "Unknown execution task");
    const observed = normalizeTask(row); sameGraph([observed], [expected]);
    insist(row.execution?.exitCode === 0 && Number.isFinite(row.execution.startTime) && Number.isFinite(row.execution.endTime) && row.execution.endTime >= row.execution.startTime, "Nonterminal execution");
    const cache = row.cache?.status;
    insist(cache === "MISS" || (cache === "HIT" && row.task === "build" && row.cache.source === "LOCAL" && allowCachedBuilds.has(row.taskId)), "Tests must execute; only this shard's earlier builds may use cache");
    return { taskId: row.taskId, commandSha256: expected.commandSha256!, cache, startTime: row.execution.startTime, endTime: row.execution.endTime, exitCode: 0 as const };
  }).sort((a: Executed, b: Executed) => compare(a.taskId, b.taskId));
}
function verifyPhase(phase: Phase | undefined, graph: Task[], buildCache: ReadonlySet<string>): void {
  insist(phase && Array.isArray(phase.executed), "Missing terminal phase"); sameGraph(phase.graph, graph);
  const expected = graph.filter(t => t.command !== null);
  insist(phase.status === (expected.length ? "passed" : "noop"), "Dishonest empty phase");
  insist(expected.length ? typeof phase.summarySha256 === "string" && /^[a-f0-9]{64}$/.test(phase.summarySha256) : phase.summarySha256 === null, "Missing run summary binding");
  insist(phase.executed.length === expected.length && new Set(phase.executed.map(t => t.taskId)).size === expected.length, "Missing or duplicate terminal tasks");
  const map = new Map(expected.map(t => [t.taskId, t]));
  for (const row of phase.executed) { const task = map.get(row.taskId); insist(task && row.commandSha256 === task.commandSha256 && row.exitCode === 0, "Wrong terminal command or exit");
    insist(Number.isFinite(row.startTime) && Number.isFinite(row.endTime) && row.endTime >= row.startTime, "Missing timing");
    insist(row.cache === "MISS" || (row.cache === "HIT" && task.task === "build" && buildCache.has(task.taskId)), "Unproven cached execution"); }
}
export function aggregate(plan: Plan, planSha256: string, receipts: unknown[], matrixResult: string): { tests: string[]; shards: number } {
  validatePlan(plan); insist(/^[a-f0-9]{64}$/.test(planSha256), "Invalid plan SHA256"); insist(matrixResult === "success", "Shard matrix did not succeed");
  insist(receipts.length === SHARD_COUNT, "Missing or extra shard receipt"); const seen = new Set<number>(), tests: string[] = [];
  for (const value of receipts) {
    insist(record(value) && value.schemaVersion === 1 && value.status === "passed" && value.planSha256 === planSha256 && canonical(value.context) === canonical(plan.context), "Failed, cancelled, or foreign receipt");
    const receipt = value as Receipt; insist(Number.isInteger(receipt.shard) && receipt.shard >= 0 && receipt.shard < SHARD_COUNT && !seen.has(receipt.shard), "Duplicate or unknown shard"); seen.add(receipt.shard);
    const assigned = plan.shards[receipt.shard]!.tests; insist(canonical(receipt.assignedTests) === canonical(assigned), "Wrong shard assignment");
    verifyPhase(receipt.build, plan.buildGraph, new Set());
    const earlierBuilds = new Set(receipt.build!.executed.map(t => t.taskId)); verifyPhase(receipt.test, dependencyClosure(plan.testGraph, assigned), earlierBuilds);
    tests.push(...receipt.test!.executed.filter(t => t.taskId.endsWith("#test")).map(t => t.taskId));
  }
  const expected = plan.testGraph.filter(t => t.task === "test" && t.command !== null).map(t => t.taskId).sort();
  insist(new Set(tests).size === tests.length && canonical(tests.sort()) === canonical(expected), "Tests were omitted or executed on more than one shard");
  return { tests, shards: seen.size };
}
