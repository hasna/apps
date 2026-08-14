import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { saveKit, getKit, listKits, updateKit, deleteKit, searchKits, kitToProfile } from "../lib/kits.js";
import { resetDb, setDbPath } from "../lib/db.js";

let testDbPath = "";
import type { DesignTokens } from "../lib/tokenizer.js";

const FIXTURE_TOKENS: DesignTokens = {
  colors: [
    { value: "#1a1a2e", frequency: 10, source: "css-var" },
    { value: "#e94560", frequency: 6, source: "computed" },
  ],
  typography: {
    fontFamilies: ["Inter"],
    fontSizes: ["1rem", "1.25rem"],
    fontWeights: ["400", "600"],
    lineHeights: ["1.5"],
    letterSpacings: ["0.01em"],
    fontFaces: [],
    families: [{ name: "Inter", weights: ["400", "600"], styles: [], isVariable: false }],
    scale: [],
  },
  spacing: ["1rem", "2rem"],
  borderRadius: ["6px", "12px"],
  shadows: ["0 2px 8px rgba(0,0,0,0.15)"],
  transitions: ["all 0.2s ease"],
  zIndices: ["1", "100"],
  gradients: [],
};

beforeEach(() => {
  testDbPath = join(tmpdir(), `styles-kits-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  setDbPath(testDbPath);
});

afterEach(() => {
  resetDb();
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const p = testDbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
});

describe("saveKit", () => {
  test("creates a kit with required fields", () => {
    const kit = saveKit({ name: "test-kit", url: "https://example.com", tokens: FIXTURE_TOKENS });
    expect(kit.id).toBeDefined();
    expect(kit.name).toBe("test-kit");
    expect(kit.url).toBe("https://example.com");
    expect(kit.tokens).toEqual(FIXTURE_TOKENS);
    expect(kit.tags).toEqual([]);
    expect(kit.createdAt).toBeGreaterThan(0);
  });

  test("stores tags and notes", () => {
    const kit = saveKit({ name: "tagged", url: "https://x.com", tokens: FIXTURE_TOKENS, tags: ["dark", "minimal"], notes: "Nice design" });
    expect(kit.tags).toEqual(["dark", "minimal"]);
    expect(kit.notes).toBe("Nice design");
  });
});

describe("getKit", () => {
  test("returns null for unknown id", () => {
    expect(getKit("nonexistent-id")).toBeNull();
  });

  test("retrieves a saved kit by id", () => {
    const saved = saveKit({ name: "get-test", url: "https://test.com", tokens: FIXTURE_TOKENS });
    const retrieved = getKit(saved.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("get-test");
    expect(retrieved!.tokens.colors.length).toBe(2);
  });
});

describe("listKits", () => {
  test("returns empty array when no kits", () => {
    expect(listKits()).toEqual([]);
  });

  test("returns all kits ordered by createdAt desc", () => {
    saveKit({ name: "first", url: "https://a.com", tokens: FIXTURE_TOKENS });
    saveKit({ name: "second", url: "https://b.com", tokens: FIXTURE_TOKENS });
    const kits = listKits();
    expect(kits.length).toBe(2);
    expect(kits[0].createdAt).toBeGreaterThanOrEqual(kits[1].createdAt);
  });

  test("filters by search query", () => {
    saveKit({ name: "linear-dark", url: "https://linear.app", tokens: FIXTURE_TOKENS });
    saveKit({ name: "stripe-minimal", url: "https://stripe.com", tokens: FIXTURE_TOKENS });
    const results = listKits({ search: "linear" });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("linear-dark");
  });

  test("filters by tags", () => {
    saveKit({ name: "a", url: "https://a.com", tokens: FIXTURE_TOKENS, tags: ["dark"] });
    saveKit({ name: "b", url: "https://b.com", tokens: FIXTURE_TOKENS, tags: ["light"] });
    const results = listKits({ tags: ["dark"] });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("a");
  });
});

describe("updateKit", () => {
  test("updates name and tags", () => {
    const kit = saveKit({ name: "old-name", url: "https://x.com", tokens: FIXTURE_TOKENS });
    const updated = updateKit(kit.id, { name: "new-name", tags: ["updated"] });
    expect(updated.name).toBe("new-name");
    expect(updated.tags).toEqual(["updated"]);
  });

  test("throws for unknown id", () => {
    expect(() => updateKit("bad-id", { name: "x" })).toThrow();
  });
});

describe("deleteKit", () => {
  test("removes a kit", () => {
    const kit = saveKit({ name: "to-delete", url: "https://del.com", tokens: FIXTURE_TOKENS });
    deleteKit(kit.id);
    expect(getKit(kit.id)).toBeNull();
  });
});

describe("searchKits", () => {
  test("searches by name", () => {
    saveKit({ name: "vercel-dark", url: "https://vercel.com", tokens: FIXTURE_TOKENS });
    saveKit({ name: "notion-clean", url: "https://notion.so", tokens: FIXTURE_TOKENS });
    expect(searchKits("vercel").length).toBe(1);
    expect(searchKits("notion").length).toBe(1);
    expect(searchKits("xyz").length).toBe(0);
  });
});

describe("kitToProfile", () => {
  test("converts kit to profile input", () => {
    const kit = saveKit({ name: "test", url: "https://test.com", tokens: FIXTURE_TOKENS });
    const profileInput = kitToProfile(kit, "my-profile");
    expect(profileInput.name).toBe("my-profile");
    expect(profileInput.category).toBe("custom");
    expect(profileInput.tags).toContain("extracted");
    expect(profileInput.description).toContain("https://test.com");
    expect(Object.keys(profileInput.colors as Record<string, string>).length).toBeGreaterThan(0);
    expect((profileInput.componentRules as { borderRadius: string[] }).borderRadius).toEqual(FIXTURE_TOKENS.borderRadius);
  });
});
