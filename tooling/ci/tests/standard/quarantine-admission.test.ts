/**
 * Quarantine admission — standard-adherence suite.
 *
 * Why this exists (dep-docs-1): a member manifest declaring a dependency with
 * a range (e.g. `^19.0.0`) can quietly resolve to a version published inside
 * the fleet 7-day minimumReleaseAge window (604800s quarantine, tooling policy
 * on bunfig minimumReleaseAge). Measured 2026-08-26:
 *
 *   - @types/react-dom 19.2.5 published 2026-08-23T21:05:23.671Z — 3 days old
 *     at measurement, inside the window.
 *   - apps/docs, apps/draw and apps/slides all declared `"@types/react-dom":
 *     "^19.0.0"`, which admits 19.2.5. The version is absent from
 *     minimumReleaseAgeExcludes, so a fresh resolution is either refused
 *     closed by the quarantine or — in a build without the fleet policy —
 *     installs a release that is younger than the quarantine floor.
 *   - Remediation: an exact pre-window pin (19.2.4, published 2026-07-30) in
 *     each affected member manifest. Ranges admit whatever publishes next;
 *     only an exact pin keeps resolution inside the window forever.
 *
 * The quarantine is deliberately NOT whitelisted away here: adding a
 * third-party package to minimumReleaseAgeExcludes would disarm the very
 * containment this check exists to defend. The policy's own rule is "never
 * lower the quarantine"; the pinned version is the only compliant fix.
 *
 * SCOPE: this check scans every publishable member's direct declaration of
 * @types/react-dom and fires when the specifier admits ANY version published
 * within the last 604800 seconds (measured at run time). Members declaring
 * 18.x ranges stay silent — no 18.x version is younger than the window.
 *
 * NETWORK: the check reads the public registry (npm view <dep> time /
 * version). A network failure produces an explicit [SKIP quarantine-admission]
 * marker and skips the hard assertion, mirroring the published-pins lane's
 * registry contract; CI has network, so the gate is live there.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APPS_DIR, publishableMembers } from "./census";

export const QUARANTINE_WINDOW_SECONDS = 604800; // fleet minimumReleaseAge, 7 days
export const DEPENDENCY = "@types/react-dom";
const NETWORK_FAILURE = /EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ENOTFOUND/i;

export interface QuarantineAdmission {
  member: string;
  dependency: string;
  spec: string;
  freshVersions: string[];
}

/** Collect one member's declared specifier for the checked dependency. */
export function declaredSpec(manifest: Record<string, unknown>): string | null {
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const deps = manifest[section];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    const spec = (deps as Record<string, unknown>)[DEPENDENCY];
    if (typeof spec === "string" && spec.length > 0) return spec;
  }
  return null;
}

/**
 * Does the specifier admit any version published inside the quarantine
 * window? `admittedVersions` is the specifier's resolution per the registry;
 * `publishedTimes` maps version -> publish instant (ISO). A missing or
 * unparseable time is unverifiable and stays silent (not provably fresh);
 * nothing is asserted against it.
 */
export function findQuarantineAdmissions(
  member: string,
  spec: string,
  admittedVersions: string[],
  publishedTimes: Record<string, string | null>,
  nowMs: number,
  windowSeconds: number = QUARANTINE_WINDOW_SECONDS,
): QuarantineAdmission | null {
  const windowMs = windowSeconds * 1000;
  const fresh = admittedVersions.filter((v) => {
    const t = publishedTimes[v];
    if (!t) return false;
    const publishedMs = Date.parse(t);
    if (Number.isNaN(publishedMs)) return false;
    return nowMs - publishedMs < windowMs;
  });
  if (fresh.length === 0) return null;
  return { member, dependency: DEPENDENCY, spec, freshVersions: fresh };
}

/** Fetch a dep's publish times from the npm registry; null on network failure.
 * Version keys only: the "created"/"modified" bookkeeping keys are dropped. */
export async function fetchPublishedTimes(dep: string): Promise<Record<string, string> | null> {
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
    if (NETWORK_FAILURE.test(stderr)) return null;
    return {}; // non-network failure (e.g. E404): nothing verifiably published
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d+\.\d+\.\d+/.test(k)) continue;
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** Fetch the versions a specifier admits, per the registry; null on network failure. */
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
    if (NETWORK_FAILURE.test(stderr)) return null;
    return [];
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    // Registry shape differs by specifier: a range returns an array
    // ("[\"19.2.4\",\"19.2.5\"]"), an exact version returns a bare string
    // ("\"19.2.4\""). Normalize the string form so the exact-pin case asserts
    // instead of skipping.
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    if (typeof parsed === "string") return [parsed];
    return null;
  } catch {
    return null;
  }
}

describe("standard-adherence: quarantine admission (7-day minimumReleaseAge window)", () => {
  test("self-test: a range admitting a window-fresh version fires", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineAdmissions(
      "docs",
      "^19.0.0",
      ["19.2.4", "19.2.5"],
      { "19.2.4": "2026-07-30T21:53:05.684Z", "19.2.5": "2026-08-23T21:05:23.671Z" },
      nowMs,
    );
    expect(result).toEqual({
      member: "docs",
      dependency: "@types/react-dom",
      spec: "^19.0.0",
      freshVersions: ["19.2.5"],
    });
  });

  test("self-test: an exact pre-window pin stays silent", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineAdmissions(
      "docs",
      "19.2.4",
      ["19.2.4"],
      { "19.2.4": "2026-07-30T21:53:05.684Z" },
      nowMs,
    );
    expect(result).toBeNull();
  });

  test("self-test: a range whose latest admitted version is pre-window stays silent", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineAdmissions(
      "docs",
      "^19.0.0",
      ["19.2.4"],
      { "19.2.4": "2026-07-30T21:53:05.684Z" },
      nowMs,
    );
    expect(result).toBeNull();
  });

  test("self-test: an unverifiable publish time is not provably fresh — silent", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineAdmissions("docs", "^19.0.0", ["19.2.5"], { "19.2.5": null }, nowMs);
    expect(result).toBeNull();
  });

  test("self-test: declaredSpec reads first matching section and ignores absent dep", () => {
    expect(declaredSpec({ devDependencies: { [DEPENDENCY]: "^19.0.0" } })).toBe("^19.0.0");
    expect(declaredSpec({ dependencies: { [DEPENDENCY]: "19.2.4" } })).toBe("19.2.4");
    expect(declaredSpec({ dependencies: { react: "^19.0.0" } })).toBeNull();
  });

  test("no publishable member declares @types/react-dom admitting a version younger than the 7-day quarantine window (HARD)", async () => {
    const members = publishableMembers();
    const declarations: Array<{ member: string; spec: string }> = [];
    for (const m of members) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(APPS_DIR, m.name, "package.json"), "utf8"),
      ) as Record<string, unknown>;
      const spec = declaredSpec(pkg);
      if (spec) declarations.push({ member: m.name, spec });
    }
    if (declarations.length === 0) {
      console.info("[SKIP quarantine-admission] no member declares @types/react-dom; nothing to assert");
      return;
    }

    const times = await fetchPublishedTimes(DEPENDENCY);
    if (times === null) {
      console.info(`[SKIP quarantine-admission] registry unreachable for ${DEPENDENCY}; offline/network route`);
      return;
    }

    const nowMs = Date.now();
    const violations: QuarantineAdmission[] = [];
    const admittedCache = new Map<string, string[] | null>();
    for (const decl of declarations) {
      let admitted = admittedCache.get(decl.spec);
      if (admitted === undefined) {
        admitted = await fetchAdmittedVersions(DEPENDENCY, decl.spec);
        if (admitted === null) {
          console.info(`[SKIP quarantine-admission] registry unreachable for ${DEPENDENCY}@${decl.spec}; offline/network route`);
          return;
        }
        admittedCache.set(decl.spec, admitted);
      }
      const hit = findQuarantineAdmissions(decl.member, decl.spec, admitted, times, nowMs);
      if (hit) violations.push(hit);
    }

    const lines = violations.map(
      (v) =>
        `  ${v.member} declares "${v.spec}" for ${v.dependency}; admitted window-fresh version(s): ` +
        `${v.freshVersions.map((x) => `${x} (${times[x]})`).join(", ").trim() || v.freshVersions.join(", ")} — ` +
        `pin the pre-window version exactly`,
    );
    if (lines.length > 0) {
      console.info(`[standard] quarantine-window admissions (HARD):\n${lines.join("\n")}`);
    }
    expect(violations, `members whose declared spec admits a quarantine-window release:\n${lines.join("\n")}`).toEqual([]);
  }, 120_000);
});
