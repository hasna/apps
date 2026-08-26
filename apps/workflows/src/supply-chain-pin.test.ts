import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

/**
 * Regression for finding dep-workflows-1 (supply-chain pin violation).
 *
 * The lane-adapter SDK dependencies must be EXACT pre-window pins, never
 * caret/tilde ranges: a range admits freshly published versions inside the
 * fleet 7-day minimumReleaseAge quarantine, and neither exact name is listed
 * in ~/.bunfig.toml minimumReleaseAgeExcludes. Measured at the finding:
 *
 *   @anthropic-ai/claude-agent-sdk 0.3.246 — published 2026-08-25T19:15:33.170Z
 *     (inside the window), ADMITTED by the old "^0.3.234" range.
 *   @openai/codex-sdk 0.149.1 — published 2026-08-24T00:33:46.418Z (inside the
 *     window); apps/workflows/bun.lock resolves 0.147.0 (published
 *     2026-08-07T01:46:23.832Z, pre-window) but the old "^0.147.0" declaration
 *     is a drift-admitting range, not a pin.
 *
 * The pinned versions are exactly the ones the frozen app lockfile already
 * resolves, so this changes no runtime behavior — it makes the manifest match
 * reality and closes drift admission into the quarantine window.
 */
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(join(appRoot, "package.json"), "utf8"),
) as { dependencies: Record<string, string> };

const LANE_SDK_LOCKDOWN = {
  "@anthropic-ai/claude-agent-sdk": { fresh: "0.3.246", pinned: "0.3.234" },
  "@openai/codex-sdk": { fresh: "0.149.1", pinned: "0.147.0" },
} as const;

for (const [pkg, info] of Object.entries(LANE_SDK_LOCKDOWN)) {
  const name = pkg as keyof typeof LANE_SDK_LOCKDOWN;
  test(`${name} is pinned exactly and does not admit freshly published versions`, () => {
    const declared = manifest.dependencies[name];
    expect(declared, `${name} must be declared in dependencies`).toBeDefined();
    expect(
      Bun.semver.satisfies(LANE_SDK_LOCKDOWN[name].fresh, declared),
      `${name}: range "${declared}" admits ${LANE_SDK_LOCKDOWN[name].fresh}, published inside the 7-day window — pin the exact pre-window version`,
    ).toBe(false);
    expect(
      declared,
      `${name}: must be the exact pre-window pin (${LANE_SDK_LOCKDOWN[name].pinned}), not a range`,
    ).toBe(LANE_SDK_LOCKDOWN[name].pinned);
  });
}
