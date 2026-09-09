/**
 * Stale-registration scan.
 *
 * Regression for the ghost registration: a settings entry wiring
 * `hooks run fast-preview-hook` where the hook resolves nowhere. The entry is
 * reported with its settings file, and never confused with the direct-path
 * wiring the installer did not write.
 */

import { describe, expect, test } from "bun:test";
import { findStaleRegistrations } from "./registration.js";

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
