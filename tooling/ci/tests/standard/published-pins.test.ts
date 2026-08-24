/**
 * Intra-wave unpublished pins — standard-adherence suite.
 *
 * The version-wave tooling bumps a member's version (e.g. @hasna/contracts
 * 0.13.4 -> 0.14.0) and rewrites every consumer's exact pin to the new
 * version in ONE merged wave commit. When that version was never published
 * to npm, every consumer's pin fails to resolve for anyone installing the
 * published package, and the suite's own validator spawns
 * `bunx @hasna/contracts@<pin>` against a version the registry does not
 * have ("cannot-run" for every affected member). Measured instances of the
 * same class:
 *
 *   - @hasna/contracts 0.13.0 unpinned: todos d175d558 (9 members)
 *   - @hasna/contracts 0.13.2 unpinned: todos 817ab177 (24 members)
 *   - @hasna/contracts 0.14.0 unpinned: todos 90fe5c89 (O15-00663; 32
 *     members pinned by wave c4622d9094 / PR #1123 while the registry
 *     latest was 0.13.4; remediated by PR #1127)
 *
 * The wave tooling must not merge a wave that pins an intra-wave dep to a
 * version that is not on the registry: either publish the bumped package
 * before/within the same wave, or hold dependent pins at the last published
 * version until the new version is published. This check is that gate —
 * HARD, like the no-cannot-run check, because a merge that pins an
 * unpublished intra-wave version breaks every consumer of the released
 * members and the suite itself.
 *
 * SCOPE: exact pins (X.Y.Z) on intra-wave deps only — an @hasna/* package
 * that is itself a member of this tree. A `^`/`~` range resolves forward on
 * the registry and is deliberately not this class (the wave-miss test in
 * test/versioning draws the same boundary). Pins on external packages are
 * ordinary dependency bugs, not wave-tooling defects, and are out of scope.
 *
 * NETWORK: the check reads the public registry (npm view <dep> versions).
 * A network failure produces an explicit [SKIP published-pins] marker and
 * skips the hard assertion, mirroring the versioning suite's npm-parity
 * lane; CI has network, so the gate is live there.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APPS_DIR, REPO_ROOT, publishableMembers } from "./census";

export interface IntraWavePin {
  member: string;
  dependency: string;
  pin: string;
}

export interface UnpublishedPin {
  member: string;
  dependency: string;
  pin: string;
  published: string[];
}

const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const EXACT_PIN = /^\d+\.\d+\.\d+$/;
const NETWORK_FAILURE = /EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ENOTFOUND/i;

/** Collect exact pins that members place on intra-wave deps (an @hasna/*
 * package that is itself a member of this tree). The wave tooling rewrites
 * these pins when it bumps the dependency's version. */
export function collectIntraWavePins(
  members: Array<{ name: string; pkgName: string }>,
  manifests: Map<string, Record<string, unknown>>,
): IntraWavePin[] {
  const memberNames = new Set(members.map((m) => m.pkgName));
  const pins: IntraWavePin[] = [];
  for (const member of members) {
    const pkg = manifests.get(member.name);
    if (!pkg) continue;
    for (const section of DEP_SECTIONS) {
      const deps = pkg[section];
      if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
      for (const [dependency, spec] of Object.entries(deps as Record<string, unknown>)) {
        if (typeof spec !== "string" || !EXACT_PIN.test(spec)) continue;
        if (!memberNames.has(dependency)) continue; // intra-wave only
        pins.push({ member: member.name, dependency, pin: spec });
      }
    }
  }
  return pins;
}

/** Split pins into violations (pinned to a version NOT on the registry) and
 * unverifiable pins (dependency registry state unknown — null published set).
 * A pin is a violation when the exact pinned version is absent from the
 * published set; an empty published set means nothing is published, so every
 * exact pin on that dep is a violation. */
export function findUnpublishedPins(
  pins: IntraWavePin[],
  publishedByDep: Map<string, string[] | null>,
): { violations: UnpublishedPin[]; unverifiable: IntraWavePin[] } {
  const violations: UnpublishedPin[] = [];
  const unverifiable: IntraWavePin[] = [];
  for (const pin of pins) {
    const published = publishedByDep.get(pin.dependency);
    if (published === null) {
      unverifiable.push(pin);
      continue;
    }
    if (published === undefined) continue; // dep not probed; nothing to assert
    if (!published.includes(pin.pin)) {
      violations.push({ ...pin, published });
    }
  }
  return { violations, unverifiable };
}

/** Fetch the published versions of one package from the npm registry.
 * Returns null when the registry could not be read (network failure). */
export async function fetchPublishedVersions(dep: string): Promise<string[] | null> {
  const proc = Bun.spawn(["npm", "view", dep, "versions", "--json", "--fetch-timeout=5000", "--fetch-retries=0"], {
    cwd: REPO_ROOT,
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
    return []; // non-network failure (e.g. E404): nothing verifiably published
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

const REAL_MEMBERS = publishableMembers();
const REAL_MANIFESTS = new Map(
  REAL_MEMBERS.map((m) => [m.name, JSON.parse(fs.readFileSync(path.join(APPS_DIR, m.name, "package.json"), "utf8")) as Record<string, unknown>]),
);

describe("standard-adherence: intra-wave unpublished pins", () => {
  test("self-test: collection fires on exact intra-wave pins and stays silent on ranges and external deps", () => {
    const members = [
      { name: "alpha", pkgName: "@hasna/alpha" },
      { name: "beta", pkgName: "@hasna/beta" },
    ];
    const manifests = new Map<string, Record<string, unknown>>([
      [
        "alpha",
        {
          dependencies: {
            "@hasna/beta": "0.14.0", // exact intra-wave pin: collected
            "@hasna/gamma": "0.1.0", // exact but NOT intra-wave: silent
            "lodash": "4.17.21", // exact but not @hasna: silent
          },
          devDependencies: { "@hasna/beta": "^0.13.0" }, // range: silent
          peerDependencies: { "@hasna/beta": "~0.13.1" }, // range: silent
        },
      ],
      ["beta", { dependencies: {} }],
    ]);
    const pins = collectIntraWavePins(members, manifests);
    expect(pins).toEqual([{ member: "alpha", dependency: "@hasna/beta", pin: "0.14.0" }]);
  });

  test("self-test: unpublished-pin detection fires when the registry lacks the pin and stays silent when it exists", () => {
    const pins: IntraWavePin[] = [
      { member: "alpha", dependency: "@hasna/beta", pin: "0.14.0" },
      { member: "gamma", dependency: "@hasna/beta", pin: "0.13.4" },
    ];
    // The exact state measured at wave-1123's merge: @hasna/contracts 0.14.0
    // pinned by consumers while the registry latest was 0.13.4.
    const publishedByDep = new Map<string, string[] | null>([["@hasna/beta", ["0.13.4"]]]);
    const { violations, unverifiable } = findUnpublishedPins(pins, publishedByDep);
    expect(violations).toEqual([{ member: "alpha", dependency: "@hasna/beta", pin: "0.14.0", published: ["0.13.4"] }]);
    expect(unverifiable).toEqual([]);

    // Registry catches up: the same pin is now published — silent.
    const publishedByDep2 = new Map<string, string[] | null>([["@hasna/beta", ["0.13.4", "0.14.0"]]]);
    expect(findUnpublishedPins(pins, publishedByDep2).violations).toEqual([]);

    // Unverifiable registry state is not a violation.
    const publishedByDep3 = new Map<string, string[] | null>([["@hasna/beta", null]]);
    const result3 = findUnpublishedPins(pins, publishedByDep3);
    expect(result3.violations).toEqual([]);
    expect(result3.unverifiable).toEqual([pins[0], pins[1]]);
  });

  test("no publishable member exact-pins an intra-wave dep to a version not on the npm registry (HARD)", async () => {
    const pins = collectIntraWavePins(REAL_MEMBERS, REAL_MANIFESTS);
    if (pins.length === 0) {
      console.info("[SKIP published-pins] no exact intra-wave pins in tree; nothing to assert");
      return;
    }
    const deps = [...new Set(pins.map((p) => p.dependency))].sort();
    const publishedByDep = new Map<string, string[] | null>();
    for (const dep of deps) {
      const published = await fetchPublishedVersions(dep);
      if (published === null) {
        console.info(`[SKIP published-pins] registry unreachable for ${dep}; offline/network route`);
        return;
      }
      publishedByDep.set(dep, published);
    }
    const { violations, unverifiable } = findUnpublishedPins(pins, publishedByDep);
    const unverifiableLines = unverifiable.map((p) => `  ${p.member} pins ${p.dependency}@${p.pin} (registry unverifiable)`);
    if (unverifiableLines.length > 0) console.info(`[standard] intra-wave pins with unverifiable registry state:\n${unverifiableLines.join("\n")}`);
    const violationLines = violations.map(
      (v) =>
        `  ${v.member} pins ${v.dependency}@${v.pin}; registry has: ${v.published.length === 0 ? "nothing" : v.published.join(", ")} — publish ${v.dependency}@${v.pin} before/within the same wave, or hold the pin at the last published version`,
    );
    if (violationLines.length > 0) {
      console.info(`[standard] unpublished intra-wave pins (HARD):\n${violationLines.join("\n")}`);
    }
    expect(violations, `members exact-pinning an intra-wave dep to a version not on the registry:\n${violationLines.join("\n")}`).toEqual([]);
  }, 120_000);

  test("report: emit the intra-wave pin census", () => {
    const pins = collectIntraWavePins(REAL_MEMBERS, REAL_MANIFESTS);
    const byDep = new Map<string, string[]>();
    for (const p of pins) {
      byDep.set(p.dependency, [...(byDep.get(p.dependency) ?? []), `${p.member}@${p.pin}`]);
    }
    console.log(
      `\n[standard] intra-wave exact pins: ${pins.length} across ${byDep.size} dep(s)\n` +
        [...byDep.entries()]
          .map(([dep, refs]) => `  ${dep}: ${refs.join(", ")}`)
          .sort()
          .join("\n"),
    );
  });
});
