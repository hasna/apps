/**
 * Dashboard quarantine-window admissions — standard-adherence suite.
 *
 * Finding dep-instructions-dashboard-1 (PIN VIOLATION family, severity P1,
 * 2026-08-26): `apps/instructions/dashboard/package.json` declared
 * `"typescript-eslint": "^8.48.0"` — a caret range whose newest admitted
 * stable version 8.68.0 was published 2026-08-24T17:27:29Z, inside the fleet
 * 7-day minimumReleaseAge window (604800s), and the dashboard ships no
 * bun.lock freezing the resolution, with no exact-name exclusion in the
 * fleet bunfig. Measured at this lane (2026-08-27): `"@types/react-dom":
 * "^19.2.3"` at the same path admits 19.2.5 (published 2026-08-23T21:05:23Z)
 * — the dep-docs-1 class. A fresh `bun install` in the dashboard either
 * fails the 604800s guard or — on a machine without the fleet policy —
 * installs a release younger than the quarantine floor.
 *
 * WHY THIS FILE, not quarantine-pins.test.ts: that gate asserts the
 * `dependencies` of publishable members only (the shipped closure); it does
 * not reach nested, private, non-member surfaces such as apps/<app>/dashboard,
 * and the flagged specifier here is a devDependency of one. This file gates
 * the dashboard surface, scoped per the fleet convention: assert only the
 * entries this finding lane fixes (FINDING_SCOPES); report — never assert —
 * the same admissions elsewhere in the tree, so sibling lanes stay visible.
 *
 * INVARIANTS:
 *   1. (offline) finding-scope deps are declared as EXACT pins — a range is
 *      the trap, whether or not today's newest admitted version is old.
 *   2. (offline) the dashboard bun.lock exists and records the exact pinned
 *      version for each finding-scope dep (deterministic installs).
 *   3. (registry-backed) no admitted version of a finding-scope declared spec
 *      is younger than the quarantine window; network failure marks
 *      [SKIP dashboard-quarantine] and skips, mirroring quarantine-pins.
 * Two-sided controls: the self-test below seeds a window-fresh admission and
 * older pins through the shared detector (prove-it-can-fail), and the
 * offline invariants fire on a seeded caret range / missing lock.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APPS_DIR } from "./census";
import { findQuarantineAdmissions, fetchAdmittedVersions, fetchPublishTimes, QUARANTINE_MS } from "./quarantine-pins.test.ts";
import type { QuarantineSpec, AdmitInfo } from "./quarantine-pins.test.ts";

/** Finding-scope surfaces: member path (relative to apps/) -> dependency.
 * Sibling dashboard lanes extend this list when their own findings land. */
export const FINDING_SCOPES: Array<{ member: string; dependency: string }> = [
  // members added when a dashboard surface ships with finding-scope findings;
  // all bundled dashboards were removed on 2026-09-04 (#1669 wave), so none remain.
];

const EXACT_PIN = /^\d+\.\d+\.\d+$/;
const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

function declaredSpec(pkg: Record<string, unknown>, dependency: string): string | null {
  for (const section of DEP_SECTIONS) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    const spec = (deps as Record<string, unknown>)[dependency];
    if (typeof spec === "string" && spec.length > 0) return spec;
  }
  return null;
}

/** Recurse apps/ for manifests; skip vendor/lock/source dirs. */
function collectManifests(dir: string): Array<{ rel: string; pkg: Record<string, unknown> }> {
  const out: Array<{ rel: string; pkg: Record<string, unknown> }> = [];
  const skip = new Set(["node_modules", ".git", "dist", ".test-home", "coverage"]);
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "package.json") {
        try {
          out.push({ rel: path.relative(APPS_DIR, path.dirname(p)), pkg: JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown> });
        } catch {
          // unparseable manifest: not this class
        }
      }
    }
  };
  walk(dir);
  return out;
}

function scopedSpecs(): QuarantineSpec[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(APPS_DIR, "instructions", "dashboard", "package.json"), "utf8")) as Record<string, unknown>;
  return FINDING_SCOPES.map((s) => ({ member: s.member, dependency: s.dependency, spec: declaredSpec(pkg, s.dependency) ?? "" }));
}

const FIXTURE_NOW = Date.parse("2026-08-26T12:00:00Z");

describe("standard-adherence: nested dashboard quarantine-window admissions", () => {
  test("self-test: detector fires on a window-fresh admission and stays silent on pre-window specs", () => {
    const specimens: Array<{ spec: string; admitted: AdmitInfo; fires: boolean }> = [
      // The measured violation shape: caret range admitting the 08-24 wave.
      { spec: "^8.48.0", admitted: { version: "8.68.0", publishedAt: "2026-08-24T17:27:29.554Z" }, fires: true },
      // The post-fix shape: exact pin to a pre-window version — silent.
      { spec: "8.67.0", admitted: { version: "8.67.0", publishedAt: "2026-08-10T17:22:44.231Z" }, fires: false },
      // An exact pin to a window-fresh version is the same defect.
      { spec: "19.2.5", admitted: { version: "19.2.5", publishedAt: "2026-08-23T21:05:23.671Z" }, fires: true },
    ];
    for (const s of specimens) {
      const specs: QuarantineSpec[] = [{ member: "example/dashboard", dependency: "typescript-eslint", spec: s.spec }];
      const { violations } = findQuarantineAdmissions(specs, new Map([["typescript-eslint", s.admitted]]), QUARANTINE_MS, FIXTURE_NOW);
      expect(violations.length > 0, `spec ${s.spec} should ${s.fires ? "fire" : "stay silent"}`).toBe(s.fires);
    }
  });

  test("finding-scope deps are declared as exact pre-window pins (HARD, offline)", () => {
    if (FINDING_SCOPES.length === 0) { expect(FINDING_SCOPES.length).toBe(0); return; }
    const pkg = JSON.parse(fs.readFileSync(path.join(APPS_DIR, "instructions", "dashboard", "package.json"), "utf8")) as Record<string, unknown>;
    for (const { dependency } of FINDING_SCOPES) {
      const spec = declaredSpec(pkg, dependency);
      expect(spec, `${dependency} must be declared in apps/instructions/dashboard/package.json`).not.toBeNull();
      expect(spec, `${dependency} in apps/instructions/dashboard must be an EXACT pin (^X.Y.Z or ~X.Y.Z a range admits whatever publishes next; pin the pre-window version exactly)`).toMatch(EXACT_PIN);
    }
  });

  test("dashboard bun.lock exists and freezes the exact pins (HARD, offline)", () => {
    if (FINDING_SCOPES.length === 0) { expect(FINDING_SCOPES.length).toBe(0); return; }
    const lockPath = path.join(APPS_DIR, "instructions", "dashboard", "bun.lock");
    expect(fs.existsSync(lockPath), `apps/instructions/dashboard/bun.lock must exist (it freezes resolution for a standalone branch of the dashboard; without it a fresh install resolves the manifest range)`).toBe(true);
    const lock = fs.readFileSync(lockPath, "utf8");
    for (const { dependency } of FINDING_SCOPES) {
      const spec = declaredSpec(
        JSON.parse(fs.readFileSync(path.join(APPS_DIR, "instructions", "dashboard", "package.json"), "utf8")) as Record<string, unknown>,
        dependency,
      )!;
      expect(lock, `${dependency}@${spec} must be the recorded resolution in the dashboard bun.lock`).toContain(`${dependency}@${spec}`);
    }
  }, 30_000);

  test("no finding-scope nested dashboard spec admits a quarantine-window version; other admissions are censused (HARD, registry-backed)", async () => {
    if (FINDING_SCOPES.length === 0) { expect(FINDING_SCOPES.length).toBe(0); return; }
    const scoped = scopedSpecs();
    if (scoped.some((s) => !s.spec)) return; // offline HARD test already fails on the missing declaration
    const deps = [...new Set(FINDING_SCOPES.map((s) => s.dependency))].sort();
    const admittedByDep = new Map<string, AdmitInfo>();
    let skipped = false;
    for (const dep of deps) {
      const specsForDep = scoped.filter((s) => s.dependency === dep);
      const admitted = await fetchAdmittedVersions(dep, specsForDep[0].spec);
      if (admitted === null) {
        console.info(`[SKIP dashboard-quarantine] registry unreachable for ${dep}; offline/network route`);
        skipped = true;
        continue;
      }
      if (admitted.length === 0) continue;
      const times = await fetchPublishTimes(dep);
      if (times === null) {
        console.info(`[SKIP dashboard-quarantine] registry time map unreadable for ${dep}; offline/network route`);
        skipped = true;
        continue;
      }
      // Exact pin: the admitted set is the pinned version itself.
      const version = admitted[admitted.length - 1];
      const publishedAt = times[version];
      if (!publishedAt) continue;
      admittedByDep.set(dep, { version, publishedAt });
    }
    if (skipped) return;
    const nowMs = Date.now();
    const { violations, unverifiable } = findQuarantineAdmissions(scoped, admittedByDep, QUARANTINE_MS, nowMs);
    if (unverifiable.length > 0) {
      console.info(`[standard] dashboard-quarantine specs with unverifiable registry state:\n${unverifiable.map((s) => `  ${s.member} ${s.dependency}@${s.spec}`).join("\n")}`);
    }

    // Tree-wide census for the same two deps: emit, never assert (each
    // admission is its own finding with its own fix lane).
    const manifests = collectManifests(APPS_DIR);
    const censusSpecs: QuarantineSpec[] = [];
    for (const m of manifests) {
      for (const dep of deps) {
        const spec = declaredSpec(m.pkg, dep);
        if (spec) censusSpecs.push({ member: m.rel, dependency: dep, spec });
      }
    }
    if (censusSpecs.length > 0) {
      const censusDeps = [...new Set(censusSpecs.map((s) => s.dependency))].sort();
      const censusAdmitted = new Map<string, AdmitInfo>();
      for (const dep of censusDeps) {
        const admitted = await fetchAdmittedVersions(dep, censusSpecs.find((s) => s.dependency === dep)!.spec);
        if (admitted === null || admitted.length === 0) continue;
        const times = await fetchPublishTimes(dep);
        if (times === null) continue;
        const version = admitted[admitted.length - 1];
        const publishedAt = times[version];
        if (!publishedAt) continue;
        censusAdmitted.set(dep, { version, publishedAt });
      }
      const other = findQuarantineAdmissions(censusSpecs, censusAdmitted, QUARANTINE_MS, nowMs).violations.filter(
        (v) => !FINDING_SCOPES.some((s) => s.member === v.member && s.dependency === v.dependency),
      );
      if (other.length > 0) {
        console.info(
          `[standard] dashboard-quarantine admissions OUTSIDE finding scope (separate findings, not asserted):\n` +
            other.map((v) => `  ${v.member} declares ${v.dependency}@${v.spec} -> admits ${v.admittedVersion} (${v.admittedAt})`).join("\n"),
        );
      }
    }

    const violationLines = violations.map(
      (v) =>
        `  ${v.member} declares ${v.dependency}@${v.spec}, which admits ${v.admittedVersion} published ${v.admittedAt} — inside the 7-day window (starts ${v.windowStart}). Pin to the last version published before the window (exact pin) and freeze it in the dashboard bun.lock.`,
    );
    if (violationLines.length > 0) {
      console.info(`[standard] dashboard-quarantine admissions (HARD):\n${violationLines.join("\n")}`);
    }
    expect(violations, `finding-scope dashboard declared specs admitting quarantine-window versions:\n${violationLines.join("\n")}`).toEqual([]);
  }, 120_000);
});
