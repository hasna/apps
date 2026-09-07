#!/usr/bin/env bun
/** Run every manifest-gated test once, using each Darwin fixture's required boundary.
 * There are no allowed failures. Missing/empty reports, crashes (including exit-zero
 * early exits), unexpected files and overlapping or incomplete selections fail closed.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SuiteGroup {
  id: string;
  files: string[];
  runner: "bun" | "publication";
  pattern?: string;
}
export interface GroupReport {
  id: string;
  status: number | null;
  signal?: string | null;
  error?: string;
  output: string;
  junit: string;
}
const LIFECYCLE = "src/__tests__/macos-app-lifecycle.test.ts";
const PUBLICATION = "src/__tests__/release-output-publication-contract.test.ts";
const PUBLICATION_NAMES = "(?:macOS finalized artifact installer|release output publication contract)(?:\\s|$)";

export function planReleaseSuite(files: string[], platform: string): SuiteGroup[] {
  if (!files.length || new Set(files).size !== files.length || files.some(f => !/^src\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.test\.ts$/.test(f))) {
    throw new Error("empty, duplicate or unsafe manifest-gated files");
  }
  if (platform !== "darwin") return [{ id: "ordinary", files: [...files], runner: "bun" }];
  for (const file of [LIFECYCLE, PUBLICATION]) if (!files.includes(file)) throw new Error(`required Darwin fixture file missing: ${file}`);
  const ordinary = files.filter(f => f !== LIFECYCLE && f !== PUBLICATION);
  if (!ordinary.length) throw new Error("empty ordinary group");
  return [
    { id: "publication", files: [LIFECYCLE, PUBLICATION], runner: "publication", pattern: `^${PUBLICATION_NAMES}` },
    { id: "lifecycle", files: [LIFECYCLE], runner: "bun", pattern: `^(?!${PUBLICATION_NAMES})` },
    { id: "ordinary", files: ordinary, runner: "bun" },
  ];
}
interface TestCase { key: string; file: string; name: string; skipped: boolean }
function fail(message: string): never { throw new Error(message); }
function entity(text: string): string {
  return text.replace(/&([^;]+);/g, (_, value: string) => {
    const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
    if (value in entities) return entities[value]!;
    const number = /^#x[0-9a-f]+$/i.test(value) ? parseInt(value.slice(2), 16) : /^#[0-9]+$/.test(value) ? Number(value.slice(1)) : NaN;
    if (!Number.isInteger(number) || number <= 0 || number > 0x10ffff) fail("invalid JUnit entity");
    return String.fromCodePoint(number);
  });
}
function count(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) fail("missing or invalid JUnit count");
  return Number(value);
}
/** Strictly parse the small XML vocabulary emitted by Bun's JUnit reporter. Unlike
 * console output, it includes filtered tests as skipped, providing a registration
 * inventory without executing the same tests again in a discovery pass.
 */
function casesFromJUnit(xml: string): TestCase[] {
  const stack: Array<{ tag: string; attrs: Record<string, string> }> = [];
  const cases: TestCase[] = [];
  const occurrences = new Map<string, number>();
  let root: Record<string, string> | undefined;
  let current: TestCase | undefined;
  let closed = false;
  const tokens = /<\?xml[^?]*\?>|<\/?[a-zA-Z]+(?:\s+[a-zA-Z]+="[^"]*")*\s*\/?>|[^<]+/gy;
  let offset = 0;
  while (offset < xml.length) {
    tokens.lastIndex = offset;
    const match = tokens.exec(xml);
    if (!match || match.index !== offset) fail("malformed or truncated JUnit XML");
    const token = match[0]; offset = tokens.lastIndex;
    if (token.startsWith("<?xml")) { if (root) fail("misplaced JUnit declaration"); continue; }
    if (!token.startsWith("<")) { if (token.trim()) fail("unexpected JUnit text"); continue; }
    const tag = /^<\/?([a-zA-Z]+)/.exec(token)![1]!;
    if (token.startsWith("</")) {
      if (!/^<\/[a-zA-Z]+\s*>$/.test(token) || stack.pop()?.tag !== tag) fail("unbalanced JUnit XML");
      if (tag === "testcase") current = undefined;
      if (tag === "testsuites") closed = true;
      continue;
    }
    if (closed) fail("data after JUnit completion");
    const attrs: Record<string, string> = {};
    for (const attr of token.matchAll(/\s+([a-zA-Z]+)="([^"]*)"/g)) {
      if (attr[1]! in attrs) fail("duplicate JUnit attribute");
      attrs[attr[1]!] = entity(attr[2]!);
    }
    const parent = stack.at(-1)?.tag;
    if (tag === "testsuites") {
      if (root || parent) fail("duplicate JUnit root");
      root = attrs;
    } else if (tag === "testsuite") {
      if (parent !== "testsuites" && parent !== "testsuite") fail("misplaced JUnit suite");
    } else if (tag === "testcase") {
      if (parent !== "testsuite" || !attrs.file || attrs.name === undefined) fail("invalid JUnit testcase");
      const names = stack.filter(s => s.tag === "testsuite").slice(1).map(s => s.attrs.name ?? fail("unnamed JUnit suite"));
      const file = attrs.file.replace(/^\.\//, "");
      const identity = JSON.stringify([file, names, attrs.name, attrs.line ?? ""]);
      const instance = occurrences.get(identity) ?? 0; occurrences.set(identity, instance + 1);
      current = { file, name: [...names, attrs.name].join(" "), key: `${identity}:${instance}`, skipped: false };
      cases.push(current);
    } else if (tag === "skipped") {
      if (parent !== "testcase" || !current || current.skipped) fail("misplaced or duplicate JUnit skip");
      current.skipped = true;
    } else fail(`unexpected JUnit element: ${tag}`);
    if (!token.endsWith("/>")) stack.push({ tag, attrs });
    else if (tag === "testcase") current = undefined;
    else if (tag === "testsuites") closed = true;
  }
  if (!root || !closed || stack.length || !cases.length) fail("missing, empty or incomplete JUnit report");
  if (count(root.tests) !== cases.length || count(root.failures) !== 0 || count(root.skipped) !== cases.filter(c => c.skipped).length || (root.errors !== undefined && count(root.errors) !== 0)) fail("JUnit totals do not explain the complete run");
  return cases;
}
const sorted = (values: Iterable<string>) => [...values].sort();
const equal = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

export function validateReleaseRun(groups: SuiteGroup[], reports: GroupReport[]): { passed: number; skipped: number; tests: number; files: number } {
  if (!groups.length || groups.some(g => !g.files.length) || new Set(groups.map(g => g.id)).size !== groups.length || reports.length !== groups.length || new Set(reports.map(r => r.id)).size !== reports.length) fail("missing, repeated or empty release group");
  const inventories = new Map<string, string[]>();
  const owned = new Map<string, number>();
  let passed = 0, skipped = 0;
  for (const group of groups) {
    const report = reports.find(r => r.id === group.id) ?? fail(`missing report: ${group.id}`);
    if (report.status !== 0 || report.signal || report.error) fail(`${group.id}: runner exited abnormally (${report.error ?? report.signal ?? report.status})`);
    const cases = casesFromJUnit(report.junit);
    if (!equal(sorted(new Set(cases.map(c => c.file))), sorted(group.files))) fail(`${group.id}: executed files differ from the planned group`);
    const selector = group.pattern ? new RegExp(group.pattern) : undefined;
    const selected = cases.filter(c => !selector || selector.test(c.name));
    if (!selected.length || group.files.some(f => !selected.some(c => c.file === f))) fail(`${group.id}: empty selected file or group`);
    if (cases.some(c => selector && !selector.test(c.name) && !c.skipped)) fail(`${group.id}: executed a test owned by another group`);
    for (const file of group.files) {
      const inventory = sorted(cases.filter(c => c.file === file).map(c => c.key));
      const previous = inventories.get(file);
      if (previous && !equal(previous, inventory)) fail(`${group.id}: shared file registration inventory changed: ${file}`);
      inventories.set(file, inventory);
    }
    const selectedSkips = selected.filter(c => c.skipped).length;
    const tally = (kind: string) => {
      const values = [...report.output.matchAll(new RegExp(`^\\s*(\\d+) ${kind}\\s*$`, "gm"))];
      return values.length === 1 ? Number(values[0]![1]) : undefined;
    };
    const summaries = [...report.output.matchAll(/^Ran (\d+) tests? across (\d+) files?\./gm)];
    if (summaries.length !== 1 || Number(summaries[0]![1]) !== selected.length || Number(summaries[0]![2]) !== group.files.length || tally("pass") !== selected.length - selectedSkips || (tally("skip") ?? 0) !== selectedSkips || tally("fail") !== 0 || /^\s*[1-9]\d* errors?\s*$/m.test(report.output)) fail(`${group.id}: console completion does not match selected JUnit tests`);
    for (const c of selected) owned.set(c.key, (owned.get(c.key) ?? 0) + 1);
    passed += selected.length - selectedSkips; skipped += selectedSkips;
  }
  for (const inventory of inventories.values()) for (const key of inventory) if (owned.get(key) !== 1) fail("release test must belong to exactly one completed group");
  return { passed, skipped, tests: passed + skipped, files: inventories.size };
}

/** Credentials and account/storage selectors never enter a release test process.
 * This is supplemental isolation; Darwin host tools still require the audited OS
 * fixture boundaries (changing HOME cannot isolate defaults, Keychain or TCC).
 */
export function groupEnvironment(root: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  for (const directory of ["home", "tmp", "bin"]) mkdirSync(join(root, directory), { mode: 0o700 });
  // Shell children must use this exact runner even when the caller's PATH has a
  // different Bun version. No global bin or existing symlink is modified.
  symlinkSync(process.execPath, join(root, "bin", "bun"));
  return {
    HOME: join(root, "home"), TMPDIR: join(root, "tmp") + "/",
    PATH: `${join(root, "bin")}:${inherited.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin"}`,
    XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "data"), npm_config_cache: join(root, "npm-cache"),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "bun-cache"),
    RECORDINGS_TEST_TIMEOUT_MS: "120000", NO_COLOR: "1", TERM: "dumb",
    ...(inherited.CI ? { CI: inherited.CI } : {}),
    ...(inherited.LANG ? { LANG: inherited.LANG } : {}),
  };
}

export function releaseMain(): number {
  const enumeration = (mode: string) => {
    const child = spawnSync(process.execPath, ["scripts/ci-linux-suite.ts", mode], { encoding: "utf8", timeout: 60000 });
    if (child.status !== 0 || child.signal || child.error) fail(`partition ${mode} failed: ${child.stderr || child.stdout}`);
    return child.stdout;
  };
  enumeration("--check");
  const groups = planReleaseSuite(enumeration("--gated").trim().split("\n").filter(Boolean), process.platform);
  if (process.argv.includes("--plan")) { console.log(JSON.stringify(groups, null, 2)); return 0; }
  const logDir = realpathSync(mkdtempSync(join(tmpdir(), "recordings-release-gate-")));
  console.log(`release-suite-gate: reports and logs: ${logDir}`);
  const reports: GroupReport[] = [];
  for (const group of groups) {
    console.log(`release-suite-gate: running ${group.id} (${group.files.length} files)`);
    const junitPath = join(logDir, `${group.id}.xml`);
    const command = group.runner === "publication"
      ? ["/usr/bin/python3", "-I", "-B", "src/__tests__/helpers/run-publication-fixtures.py", "--bun", process.execPath, "--report-outfile", junitPath]
      : [process.execPath, "test", "--no-orphans", "--timeout", "120000", ...group.files.map(f => `./${f}`), ...(group.pattern ? ["--test-name-pattern", group.pattern] : []), "--reporter=junit", "--reporter-outfile", junitPath];
    const environmentRoot = mkdtempSync(join(logDir, `${group.id}-environment-`));
    const child = spawnSync(command[0]!, command.slice(1), { encoding: "utf8", env: groupEnvironment(environmentRoot), maxBuffer: 128 * 1024 * 1024, timeout: group.runner === "publication" ? 360000 : 30 * 60 * 1000 });
    const output = (child.stdout ?? "") + (child.stderr ?? "");
    writeFileSync(join(logDir, `${group.id}.log`), output);
    let junit = ""; try { junit = readFileSync(junitPath, "utf8"); } catch { /* Missing reports fail validation. */ }
    reports.push({ id: group.id, status: child.status, signal: child.signal, error: child.error?.message, output, junit });
  }
  writeFileSync(join(logDir, "suite.log"), reports.map(r => `=== ${r.id} ===\n${r.output}`).join("\n"));
  const result = validateReleaseRun(groups, reports);
  console.log(`release-suite-gate: PASS - ${result.passed} pass, ${result.skipped} skip, 0 fail; ${result.tests} tests across ${result.files} files, each selected once`);
  return 0;
}
if (import.meta.main) {
  try { process.exitCode = releaseMain(); }
  catch (error) { console.error(`release-suite-gate: FAIL - ${(error as Error).message}`); process.exitCode = 1; }
}
