/**
 * Quarantine-window admission — standard-adherence suite.
 *
 * Finding dep-context-1 (PIN VIOLATION family, severity P1, 2026-08-25): the
 * declared dependency ranges in `apps/context/package.json` admit stable
 * versions published inside the fleet's 7-day minimumReleaseAge window.
 * Measured at the finding: `@ai-sdk/anthropic@^3.0.81` admits 3.0.113
 * (published 2026-08-25T03:12:01Z); `ai@^6.0.198` admits 6.0.266 (published
 * 2026-08-25T03:13:03Z); the same 08-25 wave hit @ai-sdk/cohere, deepseek,
 * google, groq, mistral, openai, perplexity, togetherai, xai and
 * @mendable/firecrawl-js. Those exact names are absent from the fleet's
 * minimumReleaseAgeExcludes (211 exact names, 0 wildcards), so a fresh lock
 * resolution — including the pack-audit probe's `bun add <tarball>` at
 * publish time, which installs from the manifest with no lockfile — selects
 * the quarantine-blocked max and fails the 604800s guard.
 *
 * This gate is the repo-side fix for that class: a publishable member's
 * DECLARED dependency surface must not admit a version younger than the
 * quarantine window. Repo manifests must not depend on per-machine
 * minimumReleaseAgeExcludes entries — the pack-audit probe and consumer
 * installs run on machines with their own bunfig — so the declared surface
 * itself must be quarantine-safe. The sanctioned manifest shape is an exact
 * pin to a version older than the window (the finding's fix hint: "pin older
 * versions").
 *
 * SCOPE: `dependencies` of publishable members only — the shipped closure the
 * pack audit installs. devDependencies do not ship and are not this class.
 *
 * FINDING SCOPE: the HARD assertion runs against the member(s) this finding
 * fixes (context, dep-context-1). The 2026-08-25 AI-SDK wave also admits
 * quarantine-window versions through knowledge, mementos, tai, projects and
 * testers manifests — each is its own audit finding with its own fix lane,
 * so those members are reported in the tree-wide census below but not
 * asserted. A lane lands by adding its member to FINDING_SCOPE.
 *
 * FIRST-PARTY EXEMPTION (P4 XDG wave, 2026-08-27): the assertion applies to
 * THIRD-PARTY declared dependencies only. A hasna-owned scoped dependency
 * (`@hasna/*`, `@hasnaxyz/*`, `@hasna-internal/*`, `@hasnatools/*`,
 * `@hasnastudio/*`, `@hasnafamily/*`) is published by this fleet through the
 * reviewed release flow, and the machine-side minimumReleaseAgeExcludes is
 * updated for it fleet-wide at publish time — verified for the wave's
 * `@hasna/paths@0.1.0` (bunfig excludes carry the exact name). So a
 * freshly-published first-party pin is NOT the supply-chain class this gate
 * exists for: consumer installs and the pack-audit probe are covered by the
 * excludes, not by the declared surface. Exempting first-party scopes from the
 * HARD assertion keeps the gate pointed at third-party quarantine risk while
 * letting a first-party wave land immediately after its own publish; the
 * census below still reports first-party in-window admissions so the
 * exemption is visible, never silent. Third-party deps remain asserted
 * unchanged (the original dep-context-1 class — @ai-sdk/*, ai, etc.).
 *
 * NETWORK: the check reads the public registry (`npm view`). A network
 * failure produces an explicit [SKIP quarantine-pins] marker and skips the
 * hard assertion, mirroring the published-pins check. Detection logic itself
 * is exercised offline by the two-sided self-test.
 */

/** Members this finding lane fixes. Add the member here when its own finding
 * lane lands. */
export const FINDING_SCOPE = ["context"];

/** Hasna-owned (first-party) dependency scopes. Published by this fleet
 * through the reviewed release flow; machine-side minimumReleaseAgeExcludes
 * covers them fleet-wide, so they are exempt from the declared-surface
 * quarantine assertion (see the header). Third-party deps are the asserted
 * class. */
export const FIRST_PARTY_SCOPES = [
  "@hasna/",
  "@hasnaxyz/",
  "@hasna-internal/",
  "@hasnatools/",
  "@hasnastudio/",
  "@hasnafamily/",
];

export function isFirstParty(dep: string): boolean {
  return FIRST_PARTY_SCOPES.some((prefix) => dep.startsWith(prefix));
}
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APPS_DIR, publishableMembers } from "./census";
import { mapBounded } from "./bounded-map";

/** The fleet quarantine window: bunfig minimumReleaseAge = 604800. */
export const QUARANTINE_MS = 7 * 24 * 3600 * 1000;

export interface QuarantineSpec {
  member: string;
  dependency: string;
  spec: string;
}

export interface QuarantineViolation extends QuarantineSpec {
  admittedVersion: string;
  admittedAt: string;
  windowStart: string;
}

/** Registry admit data: the max version the spec picks and its publish time.
 * null = registry could not be read for this dependency. */
export type AdmitInfo = { version: string; publishedAt: string } | null;

/** Pure detection over injected registry data (offline-testable).
 *
 * A violation is a dependency whose declared spec's admitted max version was
 * published inside the window (age < windowMs). Exact pins are included: a
 * pin to a version published inside the window is the same defect. Pins to
 * older versions are silent. Unverifiable (registry unreadable) specs are
 * reported separately and are never violations. */
export function findQuarantineAdmissions(
  specs: QuarantineSpec[],
  admittedByDep: Map<string, AdmitInfo>,
  windowMs: number,
  nowMs: number,
): { violations: QuarantineViolation[]; unverifiable: QuarantineSpec[] } {
  const violations: QuarantineViolation[] = [];
  const unverifiable: QuarantineSpec[] = [];
  const windowStart = new Date(nowMs - windowMs).toISOString();
  for (const spec of specs) {
    const admitted = admittedByDep.get(spec.dependency);
    if (admitted === undefined) continue; // dep not probed; nothing to assert
    if (admitted === null) {
      unverifiable.push(spec);
      continue;
    }
    const age = nowMs - Date.parse(admitted.publishedAt);
    if (age < windowMs) {
      violations.push({ ...spec, admittedVersion: admitted.version, admittedAt: admitted.publishedAt, windowStart });
    }
  }
  return { violations, unverifiable };
}

/** Fetch the versions a declared spec admits via the npm registry. Returns
 * null when the registry could not be read; [] when nothing matches (an
 * unresolvable spec — not a quarantine class). */
export async function fetchAdmittedVersions(dep: string, spec: string): Promise<string[] | null> {
  const proc = Bun.spawn(["npm", "view", `${dep}@${spec}`, "version", "--json", "--fetch-timeout=5000", "--fetch-retries=0"], {
    cwd: APPS_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    if (/EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ENOTFOUND/i.test(stderr)) return null;
    return []; // non-network failure (e.g. E404): nothing verifiably admitted
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    if (typeof parsed === "string") return [parsed];
    return null;
  } catch {
    return null;
  }
}

/** Fetch the publish-time map for one dependency. null when unreadable. */
export async function fetchPublishTimes(dep: string): Promise<Record<string, string> | null> {
  const proc = Bun.spawn(["npm", "view", dep, "time", "--json", "--fetch-timeout=5000", "--fetch-retries=0"], {
    cwd: APPS_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    if (/EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ENOTFOUND/i.test(stderr)) return null;
    return {};
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const times: Record<string, string> = {};
      for (const [v, t] of Object.entries(parsed as Record<string, unknown>)) {
        if (v === "created" || v === "modified") continue;
        if (typeof t === "string") times[v] = t;
      }
      return times;
    }
    return null;
  } catch {
    return null;
  }
}

/** Collect declared specs from member manifests. */
export function collectDeclaredSpecs(
  members: Array<{ name: string }>,
  manifests: Map<string, Record<string, unknown>>,
): QuarantineSpec[] {
  const specs: QuarantineSpec[] = [];
  for (const member of members) {
    const pkg = manifests.get(member.name);
    const deps = pkg?.dependencies;
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    for (const [dependency, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec !== "string") continue;
      specs.push({ member: member.name, dependency, spec });
    }
  }
  return specs;
}

const NOW = Date.parse("2026-08-26T17:00:00Z"); // measured-state fixture anchor

describe("standard-adherence: quarantine-window admissions", () => {
  test("self-test: detection fires on a spec admitting a version published inside the window and stays silent on older pins", () => {
    // Negative-control shapes (the reason the detector must discriminate):
    const fixtures: Array<{
      label: string;
      specs: QuarantineSpec[];
      admitted: Map<string, AdmitInfo>;
      expectedViolation: boolean;
    }> = [
      {
        // The exact measured violation: ^ range admitting the 08-25 wave.
        label: "measured violation: caret admits 08-25 wave",
        specs: [{ member: "context", dependency: "@ai-sdk/anthropic", spec: "^3.0.81" }],
        admitted: new Map([["@ai-sdk/anthropic", { version: "3.0.113", publishedAt: "2026-08-25T03:12:01.272Z" }]]),
        expectedViolation: true,
      },
      {
        // The post-fix shape: exact pin to a 76-day-old version — silent.
        label: "post-fix: exact pin to an old version",
        specs: [{ member: "context", dependency: "@ai-sdk/anthropic", spec: "3.0.83" }],
        admitted: new Map([["@ai-sdk/anthropic", { version: "3.0.83", publishedAt: "2026-06-11T15:58:07.908Z" }]]),
        expectedViolation: false,
      },
      {
        // An exact pin to a young version is the same defect class.
        label: "exact pin to a young version still fires",
        specs: [{ member: "context", dependency: "ai", spec: "6.0.266" }],
        admitted: new Map([["ai", { version: "6.0.266", publishedAt: "2026-08-25T03:13:03.823Z" }]]),
        expectedViolation: true,
      },
      {
        // Registry unreadable: never a violation, reported unverifiable.
        label: "unreadable registry is unverifiable, not a violation",
        specs: [{ member: "context", dependency: "@ai-sdk/anthropic", spec: "^3.0.81" }],
        admitted: new Map([["@ai-sdk/anthropic", null]]),
        expectedViolation: false,
      },
    ];
    for (const f of fixtures) {
      const { violations, unverifiable } = findQuarantineAdmissions(f.specs, f.admitted, QUARANTINE_MS, NOW);
      expect(violations.length > 0, `[${f.label}] violation expected`).toBe(f.expectedViolation);
    }
  });

  test("self-test: age boundary discriminates — 6.9-day-old version fires, 7.1-day-old is silent", () => {
    const sixNine = new Date(NOW - 6.9 * 24 * 3600 * 1000).toISOString();
    const sevenOne = new Date(NOW - 7.1 * 24 * 3600 * 1000).toISOString();
    const specs: QuarantineSpec[] = [
      { member: "context", dependency: "@ai-sdk/anthropic", spec: "^3.0.81" },
      { member: "context", dependency: "ai", spec: "^6.0.198" },
    ];
    const young = findQuarantineAdmissions(specs, new Map([["@ai-sdk/anthropic", { version: "3.0.113", publishedAt: sixNine }]]), QUARANTINE_MS, NOW);
    expect(young.violations.map((v) => v.dependency)).toEqual(["@ai-sdk/anthropic"]);
    const old = findQuarantineAdmissions(specs, new Map([["@ai-sdk/anthropic", { version: "3.0.113", publishedAt: sevenOne }]]), QUARANTINE_MS, NOW);
    expect(old.violations).toEqual([]);
  });

  test("no finding-scope member's THIRD-PARTY declared dependencies admit a quarantine-window version (HARD)", async () => {
    const members = publishableMembers();
    const manifests = new Map(
      members.map((m) => [m.name, JSON.parse(fs.readFileSync(path.join(APPS_DIR, m.name, "package.json"), "utf8")) as Record<string, unknown>]),
    );
    const specs = collectDeclaredSpecs(members, manifests);
    const scopedSpecs = specs.filter((s) => FINDING_SCOPE.includes(s.member));
    if (scopedSpecs.length === 0) {
      console.info("[SKIP quarantine-pins] no declared dependencies in finding scope; nothing to assert");
      return;
    }
    // First-party (hasna-owned) scoped deps are covered by the fleet
    // minimumReleaseAgeExcludes at publish time (see header) — exempt from the
    // HARD assertion, but reported in the census below so the exemption is
    // visible. The assertion runs on the third-party declared surface, which
    // is the supply-chain class this gate exists for.
    const assertedSpecs = scopedSpecs.filter((s) => !isFirstParty(s.dependency));
    const firstPartyScopedSpecs = scopedSpecs.filter((s) => isFirstParty(s.dependency));
    const admittedByDep = new Map<string, AdmitInfo>();
    let skipped = false;
    // Each task retains version→time ordering. Reduce results below in the
    // original dependency order so diagnostics and acceptance remain stable.
    const probe = async (dep: string, spec: string) => {
      const admitted = await fetchAdmittedVersions(dep, spec);
      const times = admitted && admitted.length > 0 ? await fetchPublishTimes(dep) : null;
      return { dep, admitted, times };
    };
    const fetchAdmitted = async (list: QuarantineSpec[]): Promise<Map<string, AdmitInfo>> => {
      const map = new Map<string, AdmitInfo>();
      const deps = [...new Set(list.map((s) => s.dependency))].sort();
      const results = await mapBounded(deps, 6, dep => probe(dep, list.find(s => s.dependency === dep)!.spec));
      for (const { dep, admitted, times } of results) {
        if (admitted === null) {
          // A first-party census miss never skips the third-party assertion:
          // the exemption is audited best-effort, the gate is not.
          if (!isFirstParty(dep)) {
            console.info(`[SKIP quarantine-pins] registry unreachable for ${dep}; offline/network route`);
            skipped = true;
          }
          continue;
        }
        if (admitted.length === 0) continue; // unresolvable spec; not a quarantine class
        if (times === null) {
          if (!isFirstParty(dep)) {
            console.info(`[SKIP quarantine-pins] registry time map unreadable for ${dep}; offline/network route`);
            skipped = true;
          }
          continue;
        }
        const maxVersion = admitted[admitted.length - 1];
        const publishedAt = times[maxVersion];
        if (!publishedAt) continue; // version on registry without a time entry; unassertable
        map.set(dep, { version: maxVersion, publishedAt });
      }
      return map;
    };
    const thirdPartyByDep = await fetchAdmitted(assertedSpecs);
    if (skipped) return;
    const nowMs = Date.now();
    const { violations, unverifiable } = findQuarantineAdmissions(assertedSpecs, thirdPartyByDep, QUARANTINE_MS, nowMs);
    // First-party census (best-effort, never asserts, never skips): keep the
    // exemption auditable.
    const firstPartyByDep = await fetchAdmitted(firstPartyScopedSpecs);
    const firstPartyViolations = findQuarantineAdmissions(firstPartyScopedSpecs, firstPartyByDep, QUARANTINE_MS, nowMs).violations;
    if (firstPartyViolations.length > 0) {
      console.info(
        `[standard] quarantine-window FIRST-PARTY pins (exempt — fleet minimumReleaseAgeExcludes covers hasna-owned scopes):\n` +
          firstPartyViolations.map((v) => `  ${v.member} declares ${v.dependency}@${v.spec} -> admits ${v.admittedVersion} (${v.admittedAt})`).join("\n"),
      );
    }
    // Tree-wide census: emit (never assert) other members' admissions so the
    // remaining findings stay visible to their fix lanes.
    const allMembersByDep = new Map<string, AdmitInfo>();
    const externalDeps = [...new Set(specs.filter((s) => !FINDING_SCOPE.includes(s.member)).map((s) => s.dependency))].sort();
    const externalResults = await mapBounded(externalDeps, 6, dep => probe(dep, specs.find(s => s.dependency === dep)!.spec));
    for (const { dep, admitted, times } of externalResults) {
      if (admitted === null || admitted.length === 0) continue;
      if (times === null) continue;
      const publishedAt = times[admitted[admitted.length - 1]];
      if (!publishedAt) continue;
      allMembersByDep.set(dep, { version: admitted[admitted.length - 1], publishedAt });
    }
    const otherViolations = findQuarantineAdmissions(specs.filter((s) => !FINDING_SCOPE.includes(s.member)), allMembersByDep, QUARANTINE_MS, nowMs).violations;
    if (otherViolations.length > 0) {
      console.info(
        `[standard] quarantine-window admissions OUTSIDE finding scope (separate findings, not asserted):\n` +
          otherViolations.map((v) => `  ${v.member} declares ${v.dependency}@${v.spec} -> admits ${v.admittedVersion} (${v.admittedAt})`).join("\n"),
      );
    }
    const unverifiableLines = unverifiable.map((s) => `  ${s.member} declares ${s.dependency}@${s.spec} (registry unverifiable)`);
    if (unverifiableLines.length > 0) console.info(`[standard] quarantine-window specs with unverifiable registry state:\n${unverifiableLines.join("\n")}`);
    const violationLines = violations.map(
      (v) =>
        `  ${v.member} declares ${v.dependency}@${v.spec}, which admits ${v.admittedVersion} published ${v.admittedAt} — inside the 7-day window (starts ${v.windowStart}). Pin to the last version published before the window (exact pin) or the fresh-resolution and pack-audit installs fail the 604800s guard.`,
    );
    if (violationLines.length > 0) {
      console.info(`[standard] quarantine-window admissions (HARD):\n${violationLines.join("\n")}`);
    }
    expect(violations, `declared dependency ranges admitting quarantine-window versions:\n${violationLines.join("\n")}`).toEqual([]);
  }, 120_000);
});
