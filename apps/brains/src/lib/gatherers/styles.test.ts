// agent-authored (no SOL consult available)

import { describe, expect, test, mock } from "bun:test";
import { gatherFromStyles } from "./styles.js";

// Per-test SDK fixture state, read at call time by the mocked module.
const sdkState: {
  profiles: unknown[];
  prefs: unknown[];
  throwOnProfiles?: boolean;
} = { profiles: [], prefs: [] };

describe("gatherFromStyles", () => {
  test("returns an empty result when the SDK package is not installed", async () => {
    mock.module("@hasnaxyz/styles", () => {
      throw new Error("module not found");
    });
    const result = await gatherFromStyles();
    expect(result.source).toBe("styles");
    expect(result.examples).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("builds profile and preference examples", async () => {
    mock.module("@hasnaxyz/styles", () => ({
      listProfiles: async () => {
        if (sdkState.throwOnProfiles) throw new Error("boom");
        return sdkState.profiles;
      },
      listPrefs: async () => sdkState.prefs,
    }));
    sdkState.throwOnProfiles = false;
    sdkState.profiles = [{ name: "dark", colors: { bg: "#000" } }];
    sdkState.prefs = [{ key: "font_size", value: "14" }];

    const result = await gatherFromStyles({ limit: 9 });
    expect(result.count).toBe(2);

    const profileExample = result.examples[0]!;
    expect(profileExample.messages[0]?.content).toContain("design-aware");
    expect(profileExample.messages[1]?.content).toBe(
      'What are the style settings in the "dark" profile?',
    );
    expect(profileExample.messages[2]?.content).toContain('"colors"');
    expect(profileExample.messages[2]?.content).toContain('"#000"');

    const prefExample = result.examples[1]!;
    expect(prefExample.messages[1]?.content).toBe('What is my preference for "font_size"?');
    expect(prefExample.messages[2]?.content).toBe("Your preference: 14");
  });

  test("falls back to default names for missing fields", async () => {
    sdkState.profiles = [{}];
    sdkState.prefs = [{ value: 7 }];

    const result = await gatherFromStyles({ limit: 9 });
    expect(result.count).toBe(2);
    expect(result.examples[0]?.messages[1]?.content).toBe(
      'What are the style settings in the "default" profile?',
    );
    expect(result.examples[1]?.messages[1]?.content).toBe('What is my preference for "style"?');
  });

  test("a throwing SDK call degrades to an empty result", async () => {
    sdkState.throwOnProfiles = true;
    const result = await gatherFromStyles();
    expect(result.source).toBe("styles");
    expect(result.count).toBe(0);
  });
});
