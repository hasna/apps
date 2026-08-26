/**
 * Supply-chain quarantine pins: @anthropic-ai/sdk (standard-adherence suite).
 *
 * Background (finding dep-terminal-1): @anthropic-ai/sdk publishes often.
 * Version 0.120.0 was published 2026-08-19T22:05:37.731Z — inside the fleet
 * 7-day minimumReleaseAge quarantine (604800s): `bun install` refuses a
 * specifier resolving to a version published within the last 7 days with
 * `blocked by minimum-release-age: 604800 seconds` unless the exact package
 * name is listed in the governing minimumReleaseAgeExcludes. Members declared
 * CARET ranges on this SDK (`^0.39.0` in apps/terminal, `^0.52.0` in
 * apps/testers, `^0.82.0` in apps/evals, while apps/browser already pins
 * exact `0.104.1`). A range is the one specifier form that silently changes
 * resolution at registry time on the next clean install, and when a fresh
 * SDK publish lands inside the quarantine window the consumer install either
 * fails closed or — with the package excluded — admits a version that landed
 * under the quarantine. The sanctioned remediation for a member depending on
 * a frequently-publishing third-party SDK is an EXACT pin of a version
 * published at least 7 days ago (apps/browser precedent; the fleet quarantine
 * makes a fresh exact pin fail closed at install time, so the pin must be
 * older than the window).
 *
 * Scope: deliberately narrow — @anthropic-ai/sdk only. It does not apply to
 * @hasna/* pins (the version-wave tooling owns those in published-pins.ts) and
 * it does not flatten every external dependency range to a pin: ranges remain
 * the ordinary convention across this tree; this SDK is the measured,
 * quarantine-relevant case.
 *
 * NETWORK: the age half reads the public registry (npm view <dep> time). A
 * network failure produces an explicit [SKIP sdk-pins] marker and skips the
 * HARD assertion, mirroring the published-pins lane; CI has network, so the
 * gate is live there. The exact-pin half is deterministic and always on.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APPS_DIR, publishableMembers } from "./census";

const SDK = "@anthropic-ai/sdk";
const QUARANTINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EXACT_PIN = /^\d+\.\d+\.\d+$/;
const DEP_SECTIONS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;
const NETWORK_FAILURE = /EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ENOTFOUND|fetch failed|Failed to fetch/i;

export interface SdkSpec {
  member: string;
  spec: string;
}

/** Collect the @anthropic-ai/sdk specifier per member, from shipped sections
 * only (dependencies / optionalDependencies / peerDependencies —
 * devDependencies never enter a consumer's install). */
export function collectSdkSpecs(
  members: Array<{ name: string; pkgName: string }>,
  manifests: Map<string, Record<string, unknown>>,
): SdkSpec[] {
  const specs: SdkSpec[] = [];
  for (const member of members) {
    const pkg = manifests.get(member.name);
    if (!pkg) continue;
    for (const section of DEP_SECTIONS) {
      const deps = pkg[section];
      if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
      const spec = (deps as Record<string, unknown>)[SDK];
      if (typeof spec === "string") {
        specs.push({ member: member.name, spec });
        break;
      }
    }
  }
  return specs;
}

/** Publish time of one package version from the npm registry.
 * Returns { ts } on success, null when the registry could not be read
 * (network failure) and the version is unknown when ts is undefined. */
export async function fetchPublishTime(dep: string, version: string): Promise<{ ts: string } | null> {
  const proc = Bun.spawn(["npm", "view", dep, "time", "--json", "--fetch-timeout=5000", "--fetch-retries=0"], {
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
    return { ts: stderr }; // non-network failure: nothing verifiably measured
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const ts = parsed[version];
    return typeof ts === "string" ? { ts } : { ts: "" };
  } catch {
    return null;
  }
}

function inQuarantine(ts: string, nowMs: number): boolean {
  const publishedMs = Date.parse(ts);
  if (Number.isNaN(publishedMs)) return false;
  return nowMs - publishedMs < QUARANTINE_WINDOW_MS;
}

const REAL_MEMBERS = publishableMembers();
const REAL_MANIFESTS = new Map(
  REAL_MEMBERS.map((m) => [
    m.name,
    JSON.parse(fs.readFileSync(path.join(APPS_DIR, m.name, "package.json"), "utf8")) as Record<string, unknown>,
  ]),
);

describe("standard-adherence: @anthropic-ai/sdk supply-chain pins", () => {
  test("self-test: collection fires on shipped sections and stays silent on devDependencies and absent specifiers", () => {
    const members = [
      { name: "terminal", pkgName: "@hasna/terminal" },
      { name: "browser", pkgName: "@hasna/browser" },
    ];
    const manifests = new Map<string, Record<string, unknown>>([
      [
        "terminal",
        {
          dependencies: { "@anthropic-ai/sdk": "^0.39.0" },
          devDependencies: { "@anthropic-ai/sdk": "^0.39.0" }, // dev: not collected
        },
      ],
      [
        "browser",
        {
          dependencies: { "@anthropic-ai/sdk": "0.104.1" },
          optionalDependencies: { "@anthropic-ai/sdk": "0.104.1" }, // second section: first wins
        },
      ],
    ]);
    expect(collectSdkSpecs(members, manifests)).toEqual([
      { member: "terminal", spec: "^0.39.0" },
      { member: "browser", spec: "0.104.1" },
    ]);
  });

  test("self-test: quarantine window check fires on a fresh publish and stays silent on an old one", () => {
    const now = Date.parse("2026-08-26T17:00:00Z");
    // 0.120.0 published 08-19T22:05:37.731Z — inside the 7-day window.
    expect(inQuarantine("2026-08-19T22:05:37.731Z", now)).toBe(true);
    // 0.39.0 published 2025-02-28 — long outside the window.
    expect(inQuarantine("2025-02-28T19:36:50.105Z", now)).toBe(false);
  });

  test("no publishable member declares a non-pinned @anthropic-ai/sdk range (HARD, deterministic)", () => {
    const specs = collectSdkSpecs(REAL_MEMBERS, REAL_MANIFESTS);
    const unPinned = specs.filter((s) => !EXACT_PIN.test(s.spec));
    const lines = unPinned.map((s) => `  ${s.member} declares @anthropic-ai/sdk "${s.spec}" — must pin an exact version published at least 7 days ago (quarantine-safe)`);
    if (lines.length > 0) {
      console.info(`[standard] @anthropic-ai/sdk non-exact specifiers (HARD):\n${lines.join("\n")}`);
    }
    expect(
      unPinned,
      `members declaring a non-pinned @anthropic-ai/sdk range — the 7-day minimumReleaseAge quarantine can be tripped by the next fresh SDK publish:\n${lines.join("\n")}`,
    ).toEqual([]);
  });

  test("pinned @anthropic-ai/sdk versions must be outside the 7-day quarantine (HARD, registry-backed)", async () => {
    const specs = collectSdkSpecs(REAL_MEMBERS, REAL_MANIFESTS).filter((s) => EXACT_PIN.test(s.spec));
    if (specs.length === 0) {
      console.info("[SKIP sdk-pins] no exact @anthropic-ai/sdk pins in tree; nothing to assert");
      return;
    }
    const now = Date.now();
    const violations: string[] = [];
    const unverifiable: string[] = [];
    for (const { member, spec } of specs) {
      const res = await fetchPublishTime(SDK, spec);
      if (res === null) {
        console.info(`[SKIP sdk-pins] registry unreachable for ${SDK}; offline/network route`);
        return;
      }
      if (res.ts === "") {
        unverifiable.push(`  ${member} pins ${SDK}@${spec} (version absent from registry time map)`);
        continue;
      }
      if (inQuarantine(res.ts, now)) {
        violations.push(`  ${member} pins ${SDK}@${spec} published ${res.ts}; inside the 7-day minimumReleaseAge window`);
      }
    }
    const unverifiableLines = unverifiable.join("\n");
    if (unverifiableLines.length > 0) console.info(`[standard] @anthropic-ai/sdk pins with unverifiable registry state:\n${unverifiableLines}`);
    const violationLines = violations.join("\n");
    if (violationLines.length > 0) {
      console.info(`[standard] @anthropic-ai/sdk pins inside the quarantine window (HARD):\n${violationLines}`);
    }
    expect(
      violations,
      `pinned @anthropic-ai/sdk versions inside the 7-day quarantine — a fresh pin fails closed at install (` +
        `'blocked by minimum-release-age') unless the exact name is excluded, and exclusion should be the exception:\n` +
        (violationLines.length > 0 ? violationLines : "(none)"),
    ).toEqual([]);
  }, 120_000);

  test("report: emit the @anthropic-ai/sdk specifier census", () => {
    const specs = collectSdkSpecs(REAL_MEMBERS, REAL_MANIFESTS);
    console.log(
      `\n[standard] @anthropic-ai/sdk specifiers: ${specs.length} across members\n` +
        specs
          .map((s) => `  ${s.member}: ${s.spec}`)
          .sort()
          .join("\n"),
    );
  });
});
