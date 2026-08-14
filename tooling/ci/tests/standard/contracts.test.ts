/**
 * Contracts conformance — standard-adherence suite, check 1.
 *
 * For every publishable member that carries a hasna.contract.json, run the
 * canonical manifest validator (`contracts repo-conformance` from
 * @hasna/contracts) at the member's effective kit version and assert the
 * manifest passes. The validator is the same one the member pins: a
 * manifest claims a kit (kitVersion) and must validate against a kit that
 * understands its shape. Effective version resolution (measured
 * 2026-08-14):
 *
 *   1. the member's pinned @hasna/contracts dependency when >= 0.4.1
 *      (0.2.2 and 0.1.0 do not expose `repo-conformance`);
 *   2. else the manifest's kitVersion when that version exists on npm;
 *   3. else `latest`.
 *
 * Recorded exceptions (CONTRACTS_EXCEPTIONS) are the measured failures as
 * of 2026-08-14, each with a filed remediation task. Two-sided contract of
 * the registry: a member IN the registry must actually FAIL today (a fixed
 * member with a stale exception entry fails the suite), and a member NOT
 * in the registry must PASS. When a violation is fixed, delete its entry.
 */
import { describe, expect, test, beforeAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  REPO_ROOT,
  APPS_DIR,
  members,
  publishableMembers,
  MIN_VALIDATOR_VERSION,
  CONTRACTS_EXCEPTIONS,
  CONTRACTS_EXCEPTION_MEMBERS,
  MANIFEST_MISSING_EXCEPTIONS,
  MANIFEST_MISSING_MEMBERS,
  KIT_VERSION_EXCEPTIONS,
  KIT_VERSION_EXCEPTION_MEMBERS,
  NO_VALIDATOR_PIN,
} from "./census";

export interface ConformanceEntry {
  member: string;
  version: string;
  verdict: "ok" | "fail" | "cannot-run";
  fails: string[];
}

/** Numeric segment compare — "0.10.4" >= "0.4.1" must be TRUE (string
 * compare gets this wrong: "1" < "4"). */
function versionAtLeast(v: string, min: string): boolean {
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return true;
}

export function resolveValidatorVersion(pinned: string | undefined, kitVersion: string | undefined, known: Set<string>): string {
  if (pinned && versionAtLeast(pinned, MIN_VALIDATOR_VERSION)) return pinned;
  if (kitVersion && known.has(kitVersion)) return kitVersion;
  return "latest";
}

export function runConformance(dir: string, version: string): { verdict: "ok" | "fail" | "cannot-run"; fails: string[]; raw: string } {
  const res = spawnSync("bunx", ["--bun", `@hasna/contracts@${version}`, "repo-conformance", dir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = String(res.stdout ?? "");
  const stderr = String(res.stderr ?? "");
  const raw = `${stdout}\n${stderr}`;
  const lines = raw.split("\n");
  const verdictLine = lines.find((l) => /^(ok|fail) hasna\.service_contract\.v1/.test(l.trim()));
  const fails = lines.filter((l) => l.trimStart().startsWith("fail ")).slice(1); // drop the verdict line itself
  if (!verdictLine) {
    const errLine = lines.find((l) => l.trim().startsWith("error:"));
    return { verdict: "cannot-run", fails: fails.length ? fails : [errLine?.trim() ?? `no verdict line; rc=${res.status}`], raw };
  }
  return { verdict: verdictLine.trim().startsWith("ok ") ? "ok" : "fail", fails: fails.map((f) => f.trim()), raw };
}

function buildReport(): { entries: ConformanceEntry[]; known: Set<string>; kitByMember: Map<string, string>; pinnedByMember: Map<string, string | undefined> } {
  const known = new Set(["0.4.1", "0.4.2", "0.5.2", "0.8.1", "0.8.2", "0.8.4", "0.8.5", "0.9.0", "0.10.6"]);
  const entries: ConformanceEntry[] = [];
  const kitByMember = new Map<string, string>();
  const pinnedByMember = new Map<string, string | undefined>();
  for (const m of members()) {
    if (!m.hasManifest) continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(APPS_DIR, m.name, "hasna.contract.json"), "utf8")) as {
      kitVersion?: string;
    };
    const kitVersion = manifest.kitVersion;
    kitByMember.set(m.name, kitVersion ?? "");
    pinnedByMember.set(m.name, m.contractsDep);
    const version = resolveValidatorVersion(m.contractsDep, kitVersion, known);
    const { verdict, fails } = runConformance(`apps/${m.name}`, version);
    entries.push({ member: m.name, version, verdict, fails });
  }
  return { entries, known, kitByMember, pinnedByMember };
}

const report = buildReport();
const byMember = new Map(report.entries.map((e) => [e.member, e]));

describe("standard-adherence: contracts conformance", () => {
  test("every publishable member carries hasna.contract.json (recorded exceptions allowed)", () => {
    const missing = publishableMembers()
      .filter((m) => !m.hasManifest)
      .map((m) => m.name)
      .sort();
    const unrecorded = missing.filter((n) => !MANIFEST_MISSING_MEMBERS.has(n));
    expect(unrecorded, `members without hasna.contract.json and without a recorded exception: ${unrecorded.join(", ")}`).toEqual([]);
    // The registry must not rot: every recorded missing-manifest member must
    // actually still be missing.
    const stale = MANIFEST_MISSING_EXCEPTIONS.filter((e) => {
      const m = publishableMembers().find((x) => x.name === e.member);
      return !m || m.hasManifest;
    }).map((e) => e.member);
    expect(stale, `recorded manifest-missing exceptions that are no longer missing: ${stale.join(", ")}`).toEqual([]);
  });

  test("the validator must run for every manifest-bearing member (no cannot-run)", () => {
    const cannotRun = report.entries.filter((e) => e.verdict === "cannot-run").map((e) => `${e.member}@${e.version}`);
    expect(cannotRun, `validator could not run: ${cannotRun.join(", ")}`).toEqual([]);
  });

  test("conformance: 0 unexpected violations (recorded exceptions allowed, and each recorded exception must still fail)", () => {
    const unexpected = report.entries.filter((e) => e.verdict === "fail" && !CONTRACTS_EXCEPTION_MEMBERS.has(e.member));
    expect(
      unexpected.map((e) => `${e.member} (${e.version}): ${e.fails.join(" | ")}`),
      "unexpected contracts conformance violations",
    ).toEqual([]);
    // Two-sided registry contract: an exception entry whose member now PASSES
    // is stale and must fail the suite until removed.
    const stale = CONTRACTS_EXCEPTIONS.filter((e) => byMember.get(e.member)?.verdict === "ok").map((e) => e.member);
    expect(stale, `recorded contracts exceptions that now pass: ${stale.join(", ")}`).toEqual([]);
  });

  test("every manifest-bearing member is either passing or a recorded exception", () => {
    const unclassified = report.entries.filter((e) => {
      if (e.verdict === "ok") return false;
      return !CONTRACTS_EXCEPTION_MEMBERS.has(e.member);
    });
    expect(unclassified.map((e) => e.member)).toEqual([]);
  });

  test("kitVersion matches the pinned @hasna/contracts version where present (recorded mismatches allowed)", () => {
    const mismatches: string[] = [];
    for (const m of publishableMembers()) {
      if (!m.hasManifest) continue;
      const kit = report.kitByMember.get(m.name) ?? "";
      const pinned = report.pinnedByMember.get(m.name);
      if (!pinned) continue;
      if (kit !== pinned.replace(/^[~^]/, "")) mismatches.push(`${m.name}: kit=${kit} pinned=${pinned}`);
    }
    const unrecorded = mismatches.filter((line) => {
      const name = line.split(":")[0];
      return !KIT_VERSION_EXCEPTION_MEMBERS.has(name);
    });
    expect(unrecorded, "unrecorded kitVersion/pinned-dep mismatches").toEqual([]);
    const stale = KIT_VERSION_EXCEPTIONS.filter((e) => {
      const kit = report.kitByMember.get(e.member);
      const pinned = report.pinnedByMember.get(e.member);
      return kit === pinned?.replace(/^[~^]/, "");
    }).map((e) => e.member);
    expect(stale, `recorded kit mismatches that now agree: ${stale.join(", ")}`).toEqual([]);
  });

  test("members with a manifest but no pinned validator are all recorded", () => {
    const unpinned = report.entries
      .map((e) => e.member)
      .filter((n) => !report.pinnedByMember.get(n))
      .sort();
    const unrecorded = unpinned.filter((n) => !NO_VALIDATOR_PIN.includes(n));
    expect(unrecorded, `manifest-bearing members without a validator pin and without a recorded entry: ${unrecorded.join(", ")}`).toEqual([]);
  });

  test("self-test: the conformance check can fail (positive) and can pass (negative)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standard-contracts-self-test-"));
    try {
      const apps = path.join(root, "apps");
      fs.mkdirSync(path.join(apps, "good"), { recursive: true });
      fs.mkdirSync(path.join(apps, "bad"), { recursive: true });
      fs.copyFileSync(path.join(APPS_DIR, "accounts", "hasna.contract.json"), path.join(apps, "good", "hasna.contract.json"));
      fs.copyFileSync(path.join(APPS_DIR, "accounts", "package.json"), path.join(apps, "good", "package.json"));
      // A manifest that cannot validate against the 0.5.2 schema: wrong schema id.
      fs.writeFileSync(path.join(apps, "bad", "hasna.contract.json"), JSON.stringify({ schema: "not.a.known.schema", name: "bad" }, null, 2));
      fs.writeFileSync(path.join(apps, "bad", "package.json"), JSON.stringify({ name: "@hasna/self-test-bad", version: "0.0.0" }, null, 2));

      const goodDir = path.relative(REPO_ROOT, path.join(apps, "good"));
      const badDir = path.relative(REPO_ROOT, path.join(apps, "bad"));
      const good = runConformance(goodDir, "0.5.2");
      const bad = runConformance(badDir, "0.5.2");
      expect(good.verdict, `known-good fixture must pass (raw: ${good.raw.slice(0, 200)})`).toBe("ok");
      expect(bad.verdict, `known-bad fixture must fail`).toBe("fail");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("report: emit the per-member conformance summary", () => {
    const pass = report.entries.filter((e) => e.verdict === "ok");
    const fail = report.entries.filter((e) => e.verdict === "fail");
    console.log(
      `\n[standard] contracts conformance: ${pass.length}/${report.entries.length} pass, ${fail.length} fail (validator: pinned dep -> kitVersion -> latest)\n` +
        fail
          .map((e) => `  FAIL ${e.member} @${e.version}: ${e.fails.slice(0, 2).join(" | ")}`)
          .sort()
          .join("\n"),
    );
    expect(report.entries.length).toBeGreaterThan(0);
  });
});
