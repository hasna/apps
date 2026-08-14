import { describe, expect, test } from "bun:test";
import { buildContextSection } from "../lib/contextinjector.js";
import type { StyleMeta } from "../lib/registry.js";
import type { StyleProfile } from "../lib/profiles.js";

const FIXTURE_STYLE_META: StyleMeta = {
  name: "minimalist",
  displayName: "Minimalist",
  description: "Clean and minimal design",
  category: "Minimalist",
  tags: ["clean"],
  principles: ["Every element must earn its place", "White space is breathing room"],
};

const FIXTURE_PROFILE: StyleProfile = {
  id: "test-1",
  name: "custom-style",
  displayName: "Custom Style",
  description: "Custom design system",
  category: "custom",
  principles: ["Keep it simple"],
  antiPatterns: ["Don't nest cards"],
  typography: {},
  colors: {},
  componentRules: {},
  tags: ["custom"],
  createdAt: 0,
  builtin: false,
};

describe("buildContextSection", () => {
  test("includes style display name", () => {
    const section = buildContextSection(FIXTURE_STYLE_META, {});
    expect(section).toContain("Design Style: Minimalist");
    expect(section).toContain("<!-- open-styles-start -->");
    expect(section).toContain("<!-- open-styles-end -->");
  });

  test("includes principles when present", () => {
    const section = buildContextSection(FIXTURE_STYLE_META, {});
    expect(section).toContain("Every element must earn its place");
    expect(section).toContain("**Principles:**");
  });

  test("no principles line when empty", () => {
    const meta: StyleMeta = { ...FIXTURE_STYLE_META, principles: [] };
    const section = buildContextSection(meta, {});
    expect(section).not.toContain("**Principles:**");
  });

  test("includes anti-patterns from profile", () => {
    const section = buildContextSection(FIXTURE_PROFILE, {});
    expect(section).toContain("Don't nest cards");
    expect(section).toContain("**Anti-Patterns:**");
  });

  test("no anti-patterns line when empty", () => {
    const profile: StyleProfile = { ...FIXTURE_PROFILE, antiPatterns: [] };
    const section = buildContextSection(profile, {});
    expect(section).not.toContain("**Anti-Patterns:**");
  });

  test("includes preferences when provided (object)", () => {
    const section = buildContextSection(FIXTURE_STYLE_META, { theme: "dark", fontSize: "16px" });
    expect(section).toContain("**Project prefs:**");
    expect(section).toContain("theme=dark");
    expect(section).toContain("fontSize=16px");
  });

  test("includes preferences when provided (array)", () => {
    const section = buildContextSection(FIXTURE_STYLE_META, [
      { key: "theme", value: "light", scope: "global" },
    ]);
    expect(section).toContain("theme=light");
  });

  test("no prefs line when empty", () => {
    const section = buildContextSection(FIXTURE_STYLE_META, {});
    expect(section).not.toContain("**Project prefs:**");
  });

  test("includes managed-by note", () => {
    const section = buildContextSection(FIXTURE_STYLE_META, {});
    expect(section).toContain("Managed by open-styles");
  });
});
