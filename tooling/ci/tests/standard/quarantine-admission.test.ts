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
 * Why this adds a strict-pin policy for @types/chrome (dep-testers-2): the
 * fleet quarantine audit flags any DECLARED third-party dependency whose
 * name is absent from minimumReleaseAgeExcludes when its publisher released
 * a version inside the window — the declaration is the risk surface, and the
 * compliant remediation is the exact pre-window pin (never a whitelist entry:
 * excluding exact names disarms the containment this check defends). For
 * @types/chrome, measured 2026-08-26:
 *
 *   - 0.2.7 published 2026-08-21T19:39:32.170Z — inside the window at
 *     measurement.
 *   - apps/testers declared `"@types/chrome": "^0.0.268"` — a range form,
 *     absent from the excludes.
 *   - Remediation: exact pre-window pin 0.2.6 (published 2026-08-13) in the
 *     affected member's manifest. The strict-pin policy keeps that shape
 *     enforced: while a window-fresh release of @types/chrome exists, a member
 *     declaration must be an exact pre-window pin.
 *
 * Policy per watch-listed dependency, documented with the finding that added
 * it (the merged dep-docs-1 behavior stays unchanged):
 *
 *   - admission (dep-docs-1, @types/react-dom): fires when the declared spec
 *     ADMITS any version published inside the window. Member declaring 18.x
 *     ranges stay silent — no 18.x version is younger than the window.
 *   - strict-pin (dep-testers-2, @types/chrome): while a window-fresh
 *     published release exists, a range form is a violation and an exact pin
 *     that is itself window-fresh is a violation; only an exact pre-window
 *     pin is compliant. No other member currently declares @types/chrome, so
 *     the strict policy has no silent-range analogue at measurement.
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
const NETWORK_FAILURE = /EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ENOTFOUND/i;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

export type QuarantinePolicy = "admission" | "strict-pin";

/** Watch-listed dependencies; each row documents the finding that added it. */
export const WATCHLIST: Array<{ dependency: string; policy: QuarantinePolicy }> = [
  { dependency: "@types/react-dom", policy: "admission" }, // dep-docs-1
  { dependency: "@types/chrome", policy: "strict-pin" }, // dep-testers-2
];

export interface QuarantineViolation {
  member: string;
  dependency: string;
  spec: string;
  /** Versions published inside the window that drive the violation. */
  freshVersions: string[];
}

/** Collect one member's declared specifiers for the watch-listed dependencies. */
export function declaredSpecs(manifest: Record<string, unknown>): Array<{ dependency: string; spec: string }> {
  const out: Array<{ dependency: string; spec: string }> = [];
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const deps = manifest[section];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    for (const { dependency } of WATCHLIST) {
      const spec = (deps as Record<string, unknown>)[dependency];
      if (typeof spec === "string" && spec.length > 0) out.push({ dependency, spec });
    }
  }
  return out;
}

/** Is `version` published inside the window per `publishedTimes`? Unverifiable
 * times (missing/unparseable) are not provably fresh and return false. */
function isWindowFresh(version: string, publishedTimes: Record<string, string | null>, nowMs: number, windowSeconds: number): boolean {
  const t = publishedTimes[version];
  if (!t) return false;
  const publishedMs = Date.parse(t);
  if (Number.isNaN(publishedMs)) return false;
  return nowMs - publishedMs < windowSeconds * 1000;
}

/**
 * Does the declaration comply with its dependency's quarantine policy?
 *
 * admission — fires when the specifier admits any window-fresh version.
 * strict-pin — while any window-fresh release exists: a range form fires,
 * an exact pin that is itself window-fresh fires, an exact pre-window pin is
 * compliant. With no window-fresh release, both policies stay silent.
 */
export function findQuarantineViolations(
  member: string,
  dependency: string,
  spec: string,
  admittedVersions: string[] | null,
  publishedTimes: Record<string, string | null>,
  nowMs: number,
  policy: QuarantinePolicy = "admission",
  windowSeconds: number = QUARANTINE_WINDOW_SECONDS,
): QuarantineViolation | null {
  const freshIn = (versions: string[]) => versions.filter((v) => isWindowFresh(v, publishedTimes, nowMs, windowSeconds));

  if (policy === "admission") {
    const fresh = freshIn(admittedVersions ?? []);
    if (fresh.length === 0) return null;
    return { member, dependency, spec, freshVersions: fresh };
  }

  // strict-pin
  if (EXACT_VERSION.test(spec)) {
    const t = publishedTimes[spec];
    if (!t) return null; // unverifiable: not provably fresh, assert nothing
    if (isWindowFresh(spec, publishedTimes, nowMs, windowSeconds)) {
      return { member, dependency, spec, freshVersions: [spec] };
    }
    return null;
  }
  const windowFresh = Object.keys(publishedTimes).filter(
    (v) => publishedTimes[v] !== null && isWindowFresh(v, publishedTimes, nowMs, windowSeconds),
  );
  if (windowFresh.length === 0) return null;
  return { member, dependency, spec, freshVersions: windowFresh };
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
  test("self-test: admission policy — a range admitting a window-fresh release fires", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineViolations(
      "docs",
      "@types/react-dom",
      "^19.0.0",
      ["19.2.4", "19.2.5"],
      { "19.2.4": "2026-07-30T21:53:05.684Z", "19.2.5": "2026-08-23T21:05:23.671Z" },
      nowMs,
      "admission",
    );
    expect(result).toEqual({
      member: "docs",
      dependency: "@types/react-dom",
      spec: "^19.0.0",
      freshVersions: ["19.2.5"],
    });
  });

  test("self-test: admission policy — an 18.x range stays silent (no 18.x version younger than the window)", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineViolations(
      "tables",
      "@types/react-dom",
      "^18.3.1",
      ["18.3.1", "18.3.7"],
      { "18.3.1": "2022-11-10T12:00:00.000Z", "18.3.7": "2024-01-12T12:00:00.000Z" },
      nowMs,
      "admission",
    );
    expect(result).toBeNull();
  });

  test("self-test: strict-pin policy — the dep-testers-2 shape: a range spec for @types/chrome with the fresh 0.2.7 fires", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineViolations(
      "testers",
      "@types/chrome",
      "^0.0.268",
      ["0.0.268"],
      { "0.0.268": "2024-05-10T22:07:02.032Z", "0.2.6": "2026-08-13T23:15:49.004Z", "0.2.7": "2026-08-21T19:39:32.170Z" },
      nowMs,
      "strict-pin",
    );
    expect(result).toEqual({
      member: "testers",
      dependency: "@types/chrome",
      spec: "^0.0.268",
      freshVersions: ["0.2.7"],
    });
  });

  test("self-test: strict-pin policy — the dep-testers-2 remediation: exact pre-window 0.2.6 pin stays silent", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineViolations(
      "testers",
      "@types/chrome",
      "0.2.6",
      ["0.2.6"],
      { "0.0.268": "2024-05-10T22:07:02.032Z", "0.2.6": "2026-08-13T23:15:49.004Z", "0.2.7": "2026-08-21T19:39:32.170Z" },
      nowMs,
      "strict-pin",
    );
    expect(result).toBeNull();
  });

  test("self-test: strict-pin policy — an exact pin that is itself window-fresh fires", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineViolations(
      "testers",
      "@types/chrome",
      "0.2.7",
      ["0.2.7"],
      { "0.2.7": "2026-08-21T19:39:32.170Z" },
      nowMs,
      "strict-pin",
    );
    expect(result).toEqual({ member: "testers", dependency: "@types/chrome", spec: "0.2.7", freshVersions: ["0.2.7"] });
  });

  test("self-test: strict-pin policy — no window-fresh release: a range stays silent", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineViolations(
      "docs",
      "@types/chrome",
      "^0.0.268",
      ["0.0.268"],
      { "0.0.268": "2024-05-10T22:07:02.032Z" },
      nowMs,
      "strict-pin",
    );
    expect(result).toBeNull();
  });

  test("self-test: strict-pin policy — an unverifiable publish time is not provably fresh — silent", () => {
    const nowMs = Date.parse("2026-08-26T12:00:00Z");
    const result = findQuarantineViolations("docs", "@types/chrome", "^0.0.268", ["0.0.268"], { "0.2.7": null }, nowMs, "strict-pin");
    expect(result).toBeNull();
  });

  test("self-test: declaredSpecs reads deps/devDeps/optionalDeps and ignores absent deps", () => {
    expect(
      declaredSpecs({ devDependencies: { "@types/chrome": "^0.0.268" } }),
    ).toEqual([{ dependency: "@types/chrome", spec: "^0.0.268" }]);
    expect(declaredSpecs({ dependencies: { "@types/react-dom": "19.2.4" } })).toEqual([
      { dependency: "@types/react-dom", spec: "19.2.4" },
    ]);
    expect(declaredSpecs({ dependencies: { react: "^19.0.0" } })).toEqual([]);
  });

  test("no publishable member declares a watch-listed dependency with a quarantine-window violation (HARD)", async () => {
    const members = publishableMembers();
    const declarations: Array<{ member: string; dependency: string; spec: string; policy: QuarantinePolicy }> = [];
    for (const m of members) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(APPS_DIR, m.name, "package.json"), "utf8"),
      ) as Record<string, unknown>;
      for (const d of declaredSpecs(pkg)) {
        const rule = WATCHLIST.find((w) => w.dependency === d.dependency)!;
        declarations.push({ member: m.name, ...d, policy: rule.policy });
      }
    }
    if (declarations.length === 0) {
      console.info("[SKIP quarantine-admission] no member declares a watch-listed dependency; nothing to assert");
      return;
    }

    const nowMs = Date.now();
    const timesCache = new Map<string, Record<string, string> | null>();
    const admittedCache = new Map<string, string[] | null>();
    const violations: QuarantineViolation[] = [];
    for (const decl of declarations) {
      let times = timesCache.get(decl.dependency);
      if (times === undefined) {
        times = await fetchPublishedTimes(decl.dependency);
        if (times === null) {
          console.info(`[SKIP quarantine-admission] registry unreachable for ${decl.dependency}; offline/network route`);
          return;
        }
        timesCache.set(decl.dependency, times);
      }
      let admitted: string[] | null = null;
      if (decl.policy === "admission") {
        const key = `${decl.dependency}@${decl.spec}`;
        if (admittedCache.has(key)) {
          admitted = admittedCache.get(key) ?? null;
        } else {
          admitted = await fetchAdmittedVersions(decl.dependency, decl.spec);
          if (admitted === null) {
            console.info(`[SKIP quarantine-admission] registry unreachable for ${decl.dependency}@${decl.spec}; offline/network route`);
            return;
          }
          admittedCache.set(key, admitted);
        }
      }
      const violation = findQuarantineViolations(
        decl.member,
        decl.dependency,
        decl.spec,
        admitted,
        times ?? {},
        nowMs,
        decl.policy,
      );
      if (violation) violations.push(violation);
    }

    const lines = violations.map(
      (v) =>
        `  ${v.member} declares "${v.dependency}": "${v.spec}" — admits/comprises window-fresh version(s): ` +
        `${v.freshVersions.map((x) => `${x} (${timesCache.get(v.dependency)?.[x] ?? "?"})`).join(", ")} — ` +
        `pin the pre-window version exactly`,
    );
    if (lines.length > 0) {
      console.info(`[standard] quarantine-window admissions (HARD):\n${lines.join("\n")}`);
    }
    expect(violations, `members whose declared spec violates the quarantine-window discipline:\n${lines.join("\n")}`).toEqual([]);
  }, 120_000);
});
