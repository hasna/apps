import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { planReleaseSuite, validateReleaseRun, groupEnvironment, type GroupReport } from "../../scripts/release-suite-gate";

const lifecycle = "src/__tests__/macos-app-lifecycle.test.ts";
const publication = "src/__tests__/release-output-publication-contract.test.ts";
const ordinary = "src/__tests__/newly-added.test.ts";
const recorder = "src/__tests__/recorder.test.ts";
const files = [lifecycle, publication, recorder, ordinary];
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
function report(id: string, cases: Array<[string, string, string, boolean]>, selected: number, skips = 0): GroupReport {
  const body = cases.map(([file, group, name, skipped]) => `<testsuite name="${escape(file)}" file="${escape(file)}"><testsuite name="${escape(group)}" file="${escape(file)}"><testcase name="${escape(name)}" file="${escape(file)}" line="1">${skipped ? "<skipped/>" : ""}</testcase></testsuite></testsuite>`).join("");
  return { id, status: 0, signal: null, output: `\n ${selected - skips} pass\n ${skips} skip\n 0 fail\nRan ${selected} tests across ${new Set(cases.map(c => c[0])).size} files. [1.00ms]\n`, junit: `<testsuites tests="${cases.length}" failures="0" skipped="${cases.filter(c => c[3]).length}">${body}</testsuites>` };
}
function receipts(): GroupReport[] {
  return [
    report("recorder", [[recorder, "recorder", "simulated capture", false]], 1),
    report("publication", [[lifecycle, "macOS finalized artifact installer", "install", false], [lifecycle, "macOS signed artifact build", "sign", true], [publication, "release output publication contract", "publish", false]], 2),
    report("lifecycle", [[lifecycle, "macOS finalized artifact installer", "install", true], [lifecycle, "macOS signed artifact build", "sign", false]], 1),
    report("ordinary", [[ordinary, "ordinary", "new & correct", false]], 1),
  ];
}
describe("release suite orchestration", () => {
  test("partitions publication from child-confined lifecycle and retains newly discovered files", () => {
    const plan = planReleaseSuite(files, "darwin");
    expect(plan.map(g => g.id)).toEqual(["recorder", "publication", "lifecycle", "ordinary"]);
    expect(plan.find(g => g.id === "ordinary")!.files).toEqual([ordinary]);
    expect(planReleaseSuite(files, "linux")).toEqual([{ id: "recorder", files: [recorder], runner: "recorder" }, { id: "ordinary", files: files.filter(f => f !== recorder), runner: "bun" }]);
    expect(validateReleaseRun(plan, receipts())).toEqual({ passed: 5, skipped: 0, tests: 5, files: 4 });
  });
  test("refuses empty, duplicated, unsafe and missing required group files", () => {
    for (const input of [[], [ordinary], [...files, ordinary], [...files, "../escape.test.ts"]]) {
      expect(() => planReleaseSuite(input, "darwin")).toThrow();
    }
  });
  test("refuses missing, repeated, unknown or empty group receipts", () => {
    const plan = planReleaseSuite(files, "darwin");
    for (const records of [receipts().slice(1), [...receipts(), receipts()[0]!], [...receipts(), { ...receipts()[0]!, id: "extra" }], receipts().map(r => r.id === "ordinary" ? { ...r, junit: '<testsuites tests="0" failures="0" skipped="0"></testsuites>' } : r)]) {
      expect(() => validateReleaseRun(plan, records)).toThrow();
    }
  });
  test("fails closed for exit-zero truncation, absent summary, signals, failure and runner errors", () => {
    for (const patch of [{ junit: "" }, { junit: receipts()[0]!.junit.slice(0, -13) }, { output: "" }, { signal: "SIGKILL" }, { status: 1 }, { error: "timeout" }, { output: receipts()[0]!.output.replace("0 fail", "1 fail") }]) {
      const records = receipts(); records[0] = { ...records[0]!, ...patch };
      expect(() => validateReleaseRun(planReleaseSuite(files, "darwin"), records)).toThrow();
    }
  });
  test("refuses tests executed by both groups or silently dropped from a shared inventory", () => {
    for (const replacement of [
      report("lifecycle", [[lifecycle, "macOS finalized artifact installer", "install", false], [lifecycle, "macOS signed artifact build", "sign", false]], 2),
      report("lifecycle", [[lifecycle, "macOS signed artifact build", "sign", false]], 1),
    ]) {
      const records = receipts(); records[2] = replacement;
      expect(() => validateReleaseRun(planReleaseSuite(files, "darwin"), records)).toThrow();
    }
  });
  test("refuses missing files, unrelated tests and unowned new publication describe blocks", () => {
    const replacements = [
      report("ordinary", [["src/__tests__/unexpected.test.ts", "other", "yes", false]], 1),
      report("publication", [[lifecycle, "macOS finalized artifact installer", "install", false], [lifecycle, "macOS signed artifact build", "sign", true], [publication, "new describe", "uncovered", true]], 1),
    ];
    for (const replacement of replacements) {
      const records = receipts().map(r => r.id === replacement.id ? replacement : r);
      expect(() => validateReleaseRun(planReleaseSuite(files, "darwin"), records)).toThrow();
    }
  });
  test("retains real platform skips and duplicate parameter names as separate test instances", () => {
    const r = report("ordinary", [[ordinary, "nested group", "same", false], [ordinary, "nested group", "same", true]], 2, 1);
    expect(validateReleaseRun(planReleaseSuite([ordinary], "linux"), [r])).toEqual({ passed: 1, skipped: 1, tests: 2, files: 1 });
  });
  test("uses a fresh home and pinned Bun without inherited credentials or service selectors", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "recordings-gate-env-")));
    try {
      const env = groupEnvironment(root, { HOME: "/fixture-unused-home", PATH: "/usr/bin:/bin", CI: "true", OPENAI_API_KEY: "fictional", HASNA_RECORDINGS_API_URL: "https://fixture.invalid", NODE_OPTIONS: "--require=/fixture-unused" });
      expect(env.HOME).toBe(join(root, "home"));
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.HASNA_RECORDINGS_API_URL).toBeUndefined();
      expect(env.NODE_OPTIONS).toBeUndefined();
      expect(env.CI).toBe("true");
      const child = spawnSync("/bin/sh", ["-c", "bun --version"], { env, encoding: "utf8", timeout: 15000 });
      expect(child.status).toBe(0);
      expect(child.stdout.trim()).toBe(Bun.version);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("real Bun receipts distinguish filtered skips from platform skips and detect early exit zero", () => {
    const root = mkdtempSync(join(tmpdir(), "recordings-gate-regression-"));
    try {
      const file = "src/__tests__/fixture.test.ts";
      // Pure fixture programs only; this regression never starts the actual release gate.
      const source = join(root, "fixture.test.ts");
      writeFileSync(source, 'import {describe,test} from "bun:test"; describe("chosen",()=>{test("yes",()=>{}); test.skip("platform",()=>{});}); describe("other",()=>test("later",()=>{}));');
      const run = (pattern: string, suffix: string) => {
        const path = join(root, suffix + ".xml");
        const child = spawnSync(process.execPath, ["test", "./fixture.test.ts", "--test-name-pattern", pattern, "--reporter=junit", "--reporter-outfile", path], { cwd: root, encoding: "utf8", timeout: 15000 });
        return { id: suffix, status: child.status, signal: child.signal, output: child.stdout + child.stderr, junit: readFileSync(path, "utf8").replaceAll('file="fixture.test.ts"', `file="${file}"`) };
      };
      const groups = [{ id: "chosen", runner: "bun" as const, files: [file], pattern: "^chosen" }, { id: "other", runner: "bun" as const, files: [file], pattern: "^(?!chosen)" }];
      expect(validateReleaseRun(groups, [run("^chosen", "chosen"), run("^(?!chosen)", "other")])).toEqual({ passed: 2, skipped: 1, tests: 3, files: 1 });
      writeFileSync(source, 'process.exit(0);');
      const child = spawnSync(process.execPath, ["test", "./fixture.test.ts"], { cwd: root, encoding: "utf8", timeout: 15000 });
      expect(child.status).toBe(0);
      expect(() => validateReleaseRun([{ id: "ordinary", runner: "bun", files: [file] }], [{ id: "ordinary", status: child.status, output: child.stdout + child.stderr, junit: "" }])).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
