/**
 * Stale-registration scan.
 *
 * Regression for the ghost registration: a settings entry wiring
 * `hooks run fast-preview-hook` where the hook resolves nowhere. The entry is
 * reported with its settings file, and never confused with the direct-path
 * wiring the installer did not write.
 */

import { describe, expect, test } from "bun:test";
import { findStaleRegistrations, findRewriteOverlaps } from "./registration.js";

const FILE = "/tmp/hooks-test-home/.claude/settings.json";

function settingsWith(...commands: string[]): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [{ hooks: commands.map((command) => ({ type: "command", command })) }],
    },
  };
}

const resolvesNothing = () => false;

describe("findStaleRegistrations", () => {
  test("flags a `hooks run <name>` entry whose hook does not resolve", () => {
    const stale = findStaleRegistrations(settingsWith("hooks run fast-preview-hook"), FILE, resolvesNothing);
    expect(stale).toEqual([
      {
        file: FILE,
        event: "PreToolUse",
        hook: "fast-preview-hook",
        command: "hooks run fast-preview-hook",
      },
    ]);
  });

  test("flags the --profile form the installer emits", () => {
    const stale = findStaleRegistrations(settingsWith("hooks run fast-preview-hook --profile ab12cd34"), FILE, resolvesNothing);
    expect(stale.map((finding) => finding.hook)).toEqual(["fast-preview-hook"]);
  });

  test("flags the legacy bare `hook-<name>` form", () => {
    const stale = findStaleRegistrations(settingsWith("hook-fast-preview-hook"), FILE, resolvesNothing);
    expect(stale.map((finding) => finding.hook)).toEqual(["fast-preview-hook"]);
  });

  test("never flags a registration whose hook resolves", () => {
    const stale = findStaleRegistrations(settingsWith("hooks run gitguard"), FILE, (name) => name === "gitguard");
    expect(stale).toEqual([]);
  });

  test("never flags direct-path wiring the installer did not write", () => {
    const stale = findStaleRegistrations(
      settingsWith("python3 /custom/direct-wire.py", "node /custom/other.js"),
      FILE,
      resolvesNothing,
    );
    expect(stale).toEqual([]);
  });

  test("scans every event key and keeps each finding's own event", () => {
    const settings = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "hooks run fast-preview-hook" }] }],
        Stop: [{ hooks: [{ type: "command", command: "hooks run other-ghost" }] }],
      },
    };
    const stale = findStaleRegistrations(settings, FILE, resolvesNothing);
    expect(stale.map((finding) => [finding.event, finding.hook])).toEqual([
      ["PreToolUse", "fast-preview-hook"],
      ["Stop", "other-ghost"],
    ]);
  });

  test("returns [] for settings without a hooks object", () => {
    expect(findStaleRegistrations({ model: "x", theme: "light" }, FILE, resolvesNothing)).toEqual([]);
  });

  test("the real resolver resolves the bundled catalog and not the ghost", () => {
    // No injected resolver: this is the lookup `hooks run` itself performs.
    expect(findStaleRegistrations(settingsWith("hooks run gitguard"), FILE)).toEqual([]);
    expect(
      findStaleRegistrations(settingsWith("hooks run fast-preview-hook"), FILE).map((finding) => finding.hook),
    ).toEqual(["fast-preview-hook"]);
  });
});

/**
 * Input-rewrite overlap scan.
 *
 * The harness applies ONE `updatedInput` rewrite per tool call (last writer
 * wins), so two PreToolUse guards that both rewrite on overlapping matchers
 * cannot coexist: one of them is silently disarmed. Install refuses the
 * pairing; this scan is what doctor reports.
 */
describe("findRewriteOverlaps", () => {
  const rewriting = (matcher: string, event = "PreToolUse") => ({ matcher, event, rewritesInput: true });
  const reading = (matcher: string, event = "PreToolUse") => ({ matcher, event });

  test("reports two input-rewriting hooks on overlapping PreToolUse matchers", () => {
    const overlaps = findRewriteOverlaps(["trash-guard", "other-guard"], (name) =>
      name === "trash-guard" ? rewriting("Bash") : rewriting("^(Bash|Write)$"),
    );
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].event).toBe("PreToolUse");
    expect(overlaps[0].hooks).toEqual(["trash-guard", "other-guard"]);
  });

  test("a hook that only reads the input is not a conflict", () => {
    expect(findRewriteOverlaps(["trash-guard", "pre-bash"], (name) => (name === "trash-guard" ? rewriting("Bash") : reading("Bash")))).toEqual([]);
  });

  test("one rewriting hook alone is not a conflict", () => {
    expect(findRewriteOverlaps(["trash-guard"], () => rewriting("Bash"))).toEqual([]);
  });

  test("disjoint matchers on the same event are not a conflict", () => {
    expect(
      findRewriteOverlaps(["a", "b"], (name) => (name === "a" ? rewriting("Write") : rewriting("Read"))),
    ).toEqual([]);
  });

  test("the same matcher on a different event is not a conflict", () => {
    const meta = (name: string) => (name === "a" ? rewriting("Bash") : rewriting("Bash", "PostToolUse"));
    expect(findRewriteOverlaps(["a", "b"], meta)).toEqual([]);
  });

  test("a hook that no longer resolves is skipped, not guessed at", () => {
    expect(findRewriteOverlaps(["gone", "trash-guard"], (name) => (name === "trash-guard" ? rewriting("Bash") : undefined))).toEqual([]);
  });
});
