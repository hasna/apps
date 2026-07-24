import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uriToFile, fetchOne, fetchMany } from "../src/fetch.ts";

const CONTENT = join(import.meta.dir, "..", "content");

describe("uriToFile", () => {
  test("maps the root resource", () => {
    expect(uriToFile("uidotsh://ui", CONTENT)).toBe(join(CONTENT, "ui.md"));
  });
  test("maps a nested guideline resource", () => {
    expect(uriToFile("uidotsh://ui/design-guidelines/buttons", CONTENT)).toBe(
      join(CONTENT, "ui/design-guidelines/buttons.md"),
    );
  });
  test("strips trailing punctuation from a uri", () => {
    expect(uriToFile("uidotsh://ui/ideas).", CONTENT)).toBe(join(CONTENT, "ui/ideas.md"));
  });
  test("rejects a non-uidotsh uri", () => {
    expect(() => uriToFile("https://ui.sh/ui")).toThrow();
  });
  test("rejects unsupported or unsafe uidotsh paths", () => {
    expect(() => uriToFile("uidotsh://../secret", CONTENT)).toThrow(/Unsupported uidotsh URI|Unsafe uidotsh URI/);
    expect(() => uriToFile("uidotsh://ui/../../secret", CONTENT)).toThrow(/Unsafe uidotsh URI/);
    expect(() => uriToFile("uidotsh://other/resource", CONTENT)).toThrow(/Unsupported uidotsh URI/);
  });
});

describe("fetchOne (mirrored content)", () => {
  test("root resource lists the subskills", async () => {
    const text = await fetchOne("uidotsh://ui", { contentDir: CONTENT });
    expect(text).toContain("Subskills");
    expect(text).toContain("design");
  });
  test("buttons guideline has real content", async () => {
    const text = await fetchOne("uidotsh://ui/design-guidelines/buttons", { contentDir: CONTENT });
    expect(text.toLowerCase()).toContain("button");
    expect(text.length).toBeGreaterThan(100);
  });
  test("missing resource throws", async () => {
    await expect(fetchOne("uidotsh://ui/does-not-exist", { contentDir: CONTENT })).rejects.toThrow();
  });
});

describe("fetchMany", () => {
  test("concatenates multiple resources with headers", async () => {
    const text = await fetchMany(["uidotsh://ui/ideas", "uidotsh://ui/componentize"], { contentDir: CONTENT });
    expect(text).toContain("## uidotsh://ui/ideas");
    expect(text).toContain("## uidotsh://ui/componentize");
  });
});

describe("missing content mirror guidance", () => {
  test("single and batch fetches fail with setup guidance when content is absent", async () => {
    const previous = process.env.HASNA_UI_CONTENT_DIR;
    const emptyDir = await mkdtemp(join(tmpdir(), "hasna-ui-empty-"));

    try {
      process.env.HASNA_UI_CONTENT_DIR = emptyDir;

      await expect(fetchOne("uidotsh://ui")).rejects.toThrow(/does not redistribute ui\.sh content/);
      await expect(fetchMany(["uidotsh://ui", "uidotsh://ui/ideas"])).rejects.toThrow(/ui harvest/);
    } finally {
      if (previous === undefined) delete process.env.HASNA_UI_CONTENT_DIR;
      else process.env.HASNA_UI_CONTENT_DIR = previous;
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("content tree completeness", () => {
  test("index.json mirrors the full resource set (>= 40)", async () => {
    const idx = (await Bun.file(join(CONTENT, "index.json")).json()) as Record<string, string>;
    const keys = Object.keys(idx);
    expect(keys.length).toBeGreaterThanOrEqual(40);
    expect(keys).toContain("uidotsh://ui");
    expect(keys).toContain("uidotsh://ui/design-guidelines/typography");
  });
});
