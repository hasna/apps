import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./census";

/**
 * Quarantine-window admission — standard-adherence suite (finding dep-monitor-1).
 *
 * Finding dep-monitor-1 (PIN VIOLATION, severity P1, 2026-08-26):
 * apps/monitor/package.json declared `systeminformation: "^5.22.10"`, a caret
 * range admitting the registry max 5.33.4 — published
 * 2026-08-26T08:25:48.073Z, INSIDE the fleet's 7-day minimumReleaseAge window
 * (604800s: window start 2026-08-19T18:00Z). systeminformation is absent from
 * the fleet's minimumReleaseAgeExcludes, so any fresh resolution without a
 * frozen lockfile — the pack-audit probe at publish time, a consumer install —
 * selects the quarantined max and fails the quarantine guard. A `^`/`~`
 * range on a non-excluded package is a drift-admitting declaration, not a
 * pin.
 *
 * The finding fix hint named "pin 5.33.3", but 5.33.3 was published
 * 2026-08-25T18:20:16.969Z — itself INSIDE the window (window start
 * 2026-08-19). The last pre-window version is 5.33.1
 * (2026-07-23T15:59:25.799Z), which is also the version the frozen root
 * bun.lock already resolves (registry snapshot verified 2026-08-26), so the
 * exact pin changes no resolved runtime.
 *
 * THE GATE: a publishable member's declared dependency surface must not
 * admit a version published inside the quarantine window, and the sanctioned
 * shape is an exact pre-window pin — repo manifests must not depend on
 * per-machine minimumReleaseAgeExcludes entries.
 */
const manifest = JSON.parse(
  readFileSync(join(REPO_ROOT, "apps/monitor/package.json"), "utf8"),
) as { dependencies: Record<string, string> };

const DEP = {
  name: "systeminformation",
  /** Registry max at finding time (2026-08-26T08:25:48.073Z), inside the window. */
  fresh: "5.33.4",
  freshMaybe: ["5.33.4", "5.33.3", "5.33.2"],
  /** Last pre-window version (2026-07-23T15:59:25.799Z); what the frozen lockfile resolves. */
  pinned: "5.33.1",
} as const;

describe("apps/monitor quarantine admission (dep-monitor-1)", () => {
  test(`${DEP.name} is declared in apps/monitor dependencies`, () => {
    expect(manifest.dependencies[DEP.name]).toBeDefined();
  });

  test("declared spec does not admit versions published inside the 7-day window", () => {
    const declared = manifest.dependencies[DEP.name];
    for (const v of DEP.freshMaybe) {
      expect(
        Bun.semver.satisfies(v, declared),
        `${DEP.name}: range "${declared}" admits ${v}, published inside the 7-day window (2026-08-19T18:00Z start) — pin the exact pre-window version`,
      ).toBe(false);
    }
  });

  test("declared spec is the exact pre-window pin", () => {
    const declared = manifest.dependencies[DEP.name];
    expect(
      declared,
      `${DEP.name}: must be the exact pre-window pin (${DEP.pinned}), not a range`,
    ).toBe(DEP.pinned);
  });
});
