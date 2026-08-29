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
 * dep-secrets-1 (measured 2026-08-26): apps/secrets declared
 * "@smithy/core": "^3.25.1", which admits every 3.x release — including
 * 3.33.3, published 2026-08-20T16:03:38.635Z (6 days old at measurement,
 * inside the window). The member pins the newest pre-window release exactly
 * (3.33.2, published 2026-08-15T17:24:51.591Z) and @smithy/core is checked
 * by this gate now.
 *
 * dep-connectors-1 (measured 2026-08-27): @types/bun 'latest' and every ^1.x
 * caret range across the member manifests resolve to 1.4.0 (published
 * 2026-08-20T19:46:32.487Z), inside the window; the pinned remedy is the
 * monorepo override version 1.3.14, exact — checked by this gate now.
 *
 * SCOPE: this check scans every publishable member's direct declaration of
 * @types/react-dom, @smithy/core and @types/bun and fires when the specifier
 * admits ANY version published within the last 604800 seconds (measured at
 * run time). Members declaring 18.x @types/react-dom ranges stay silent — no
 * 18.x version is younger than the window.
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
export const DEPENDENCIES = ["@types/react-dom", "@smithy/core", "@types/bun"] as const;
export type CheckedDependency = (typeof DEPENDENCIES)[number];
const NETWORK_FAILURE = /EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ENOTFOUND/i;

export interface QuarantineAdmission {
  member: string;
  dependency: string;
  spec: string;
  freshVersions: string[];
}

/** Collect one member's declared specifier for the checked dependency. */
export function declaredSpec(manifest: Record<string, unknown>, dependency: CheckedDependency): string | null {
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const deps = manifest[section];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    const spec = (deps as Record<string, unknown>)[dependency];
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
  dependency: CheckedDependency,
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
  return { member, dependency, spec, freshVersions: fresh };
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

/**
 * Nested dashboards — apps/<name>/dashboard. These are private (private: true),
 * invisible to the publishable-member census above, and NOT workspace
 * members (workspaces: ["apps/*"]), so no workspace lockfile pins their
 * resolution: each dashboard installs standalone and a dashboard with no
 * committed bun.lock resolves its declared ranges fresh on every install.
 * That is the exact drift the quarantine gate exists to close
 * (dep-connectors-dashboard-1, measured 2026-08-27):
 *
 *   - apps/connectors/dashboard, apps/hooks/dashboard and
 *     apps/telephony/dashboard declare "^19.0.0"; apps/instructions/dashboard
 *     declares "^19.2.3" — all four admit @types/react-dom 19.2.5
 *     (published 2026-08-23, inside the 604800s window) — and none commits
 *     a bun.lock.
 *   - A nested dashboard that DOES commit a bun.lock has its resolution
 *     pinned by that lock and is outside this check's vulnerable path.
 */
export function nestedDashboards(): Array<{ member: string; spec: string }> {
  const out: Array<{ member: string; spec: string }> = [];
  for (const app of fs.readdirSync(APPS_DIR, { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const dashDir = path.join(APPS_DIR, app.name, "dashboard");
    const pkgPath = path.join(dashDir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    const spec = declaredSpec(pkg);
    if (!spec) continue;
    if (fs.existsSync(path.join(dashDir, "bun.lock"))) continue; // resolution locked
    out.push({ member: `${app.name}/dashboard`, spec });
  }
  return out;
}

describe("standard-adherence: quarantine admission (7-day minimumReleaseAge window)", () => {
  test("self-test: a range admitting a window-fresh version fires", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineAdmissions(
      "docs",
      "@types/react-dom",
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
      "@types/react-dom",
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
      "@types/react-dom",
      "^19.0.0",
      ["19.2.4"],
      { "19.2.4": "2026-07-30T21:53:05.684Z" },
      nowMs,
    );
    expect(result).toBeNull();
  });

  test("self-test: an unverifiable publish time is not provably fresh — silent", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineAdmissions("docs", "@types/react-dom", "^19.0.0", ["19.2.5"], { "19.2.5": null }, nowMs);
    expect(result).toBeNull();
  });

  test("self-test: @smithy/core range admitting a window-fresh version fires (dep-secrets-1)", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineAdmissions(
      "secrets",
      "@smithy/core",
      "^3.25.1",
      ["3.25.1", "3.33.3"],
      { "3.33.3": "2026-08-20T16:03:38.635Z" },
      nowMs,
    );
    expect(result).toEqual({
      member: "secrets",
      dependency: "@smithy/core",
      spec: "^3.25.1",
      freshVersions: ["3.33.3"],
    });
  });

  test("self-test: exact pre-window @smithy/core pin stays silent (dep-secrets-1)", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineAdmissions(
      "secrets",
      "@smithy/core",
      "3.33.2",
      ["3.33.2"],
      { "3.33.2": "2026-08-15T17:24:51.591Z" },
      nowMs,
    );
    expect(result).toBeNull();
  });

  test("self-test: @types/bun latest admitting the window-fresh 1.4.0 fires (dep-connectors-1)", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineAdmissions(
      "3scribe",
      "@types/bun",
      "latest",
      ["1.3.14", "1.4.0"],
      { "1.3.14": "2026-05-28T17:39:04.235Z", "1.4.0": "2026-08-20T19:46:32.487Z" },
      nowMs,
    );
    expect(result).toEqual({
      member: "3scribe",
      dependency: "@types/bun",
      spec: "latest",
      freshVersions: ["1.4.0"],
    });
  });

  test("self-test: declaredSpec reads first matching section and ignores absent dep", () => {
    expect(declaredSpec({ devDependencies: { "@types/react-dom": "^19.0.0" } }, "@types/react-dom")).toBe("^19.0.0");
    expect(declaredSpec({ dependencies: { "@types/react-dom": "19.2.4" } }, "@types/react-dom")).toBe("19.2.4");
    expect(declaredSpec({ dependencies: { "@types/bun": "1.3.14" } }, "@types/bun")).toBe("1.3.14");
    expect(declaredSpec({ dependencies: { react: "^19.0.0" } }, "@types/react-dom")).toBeNull();
    expect(declaredSpec({ dependencies: { "@smithy/core": "^3.25.1" } }, "@smithy/core")).toBe("^3.25.1");
  });

  test("no publishable member declares a checked dependency admitting a version younger than the 7-day quarantine window (HARD)", async () => {
    const members = publishableMembers();
    const violations: QuarantineAdmission[] = [];
    const lines: string[] = [];
    for (const dependency of DEPENDENCIES) {
      const declarations: Array<{ member: string; spec: string }> = [];
      for (const m of members) {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(APPS_DIR, m.name, "package.json"), "utf8"),
        ) as Record<string, unknown>;
        const spec = declaredSpec(pkg, dependency);
        if (spec) declarations.push({ member: m.name, spec });
      }
      if (declarations.length === 0) {
        console.info(`[SKIP quarantine-admission] no member declares ${dependency}; nothing to assert`);
        continue;
      }

      const times = await fetchPublishedTimes(dependency);
      if (times === null) {
        console.info(`[SKIP quarantine-admission] registry unreachable for ${dependency}; offline/network route`);
        continue;
      }

      const nowMs = Date.now();
      const admittedCache = new Map<string, string[] | null>();
      for (const decl of declarations) {
        let admitted = admittedCache.get(`${dependency}@${decl.spec}`);
        if (admitted === undefined) {
          admitted = await fetchAdmittedVersions(dependency, decl.spec);
          if (admitted === null) {
            console.info(`[SKIP quarantine-admission] registry unreachable for ${dependency}@${decl.spec}; offline/network route`);
            continue;
          }
          admittedCache.set(`${dependency}@${decl.spec}`, admitted);
        }
        const hit = findQuarantineAdmissions(decl.member, dependency, decl.spec, admitted, times, nowMs);
        if (hit) {
          violations.push(hit);
          lines.push(
            `  ${hit.member} declares "${hit.spec}" for ${hit.dependency}; admitted window-fresh version(s): ` +
              `${hit.freshVersions.map((x) => `${x} (${times[x] ?? "unknown"})`).join(", ").trim() || hit.freshVersions.join(", ")} — ` +
              `pin the pre-window version exactly`,
          );
        }
      }
    }

    if (lines.length > 0) {
      console.info(`[standard] quarantine-window admissions (HARD):\n${lines.join("\n")}`);
    }
    expect(violations, `members whose declared spec admits a quarantine-window release:\n${lines.join("\n")}`).toEqual([]);
  }, 120_000);

  test("no lockfile-less nested dashboard declares @types/react-dom admitting a version younger than the 7-day quarantine window (HARD)", async () => {
    const declarations = nestedDashboards();
    if (declarations.length === 0) {
      console.info("[SKIP quarantine-admission] no lockfile-less nested dashboard declares @types/react-dom; nothing to assert");
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
        `pin the pre-window version exactly and regenerate a dashboard bun.lock`,
    );
    if (lines.length > 0) {
      console.info(`[standard] quarantine-window admissions in nested dashboards (HARD):\n${lines.join("\n")}`);
    }
    expect(violations, `lockfile-less nested dashboards whose declared spec admits a quarantine-window release:\n${lines.join("\n")}`).toEqual([]);
  }, 120_000);
});
