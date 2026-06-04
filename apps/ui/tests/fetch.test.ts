import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { uriToFile, fetchOne, fetchMany } from "../src/fetch.ts";

const CONTENT = join(import.meta.dir, "..", "content");

describe("uriToFile", () => {
  test("maps the root resource", () => {
    expect(uriToFile("uidotsh://ui")).toBe(join(CONTENT, "ui.md"));
  });
  test("maps a nested guideline resource", () => {
    expect(uriToFile("uidotsh://ui/design-guidelines/buttons")).toBe(
      join(CONTENT, "ui/design-guidelines/buttons.md"),
    );
  });
  test("strips trailing punctuation from a uri", () => {
    expect(uriToFile("uidotsh://ui/ideas).")).toBe(join(CONTENT, "ui/ideas.md"));
  });
  test("rejects a non-uidotsh uri", () => {
    expect(() => uriToFile("https://ui.sh/ui")).toThrow();
  });
});

describe("fetchOne (mirrored content)", () => {
  test("root resource lists the subskills", async () => {
    const text = await fetchOne("uidotsh://ui");
    expect(text).toContain("Subskills");
    expect(text).toContain("design");
  });
  test("buttons guideline has real content", async () => {
    const text = await fetchOne("uidotsh://ui/design-guidelines/buttons");
    expect(text.toLowerCase()).toContain("button");
    expect(text.length).toBeGreaterThan(100);
  });
  test("missing resource throws", async () => {
    await expect(fetchOne("uidotsh://ui/does-not-exist")).rejects.toThrow();
  });
});

describe("fetchMany", () => {
  test("concatenates multiple resources with headers", async () => {
    const text = await fetchMany(["uidotsh://ui/ideas", "uidotsh://ui/componentize"]);
    expect(text).toContain("## uidotsh://ui/ideas");
    expect(text).toContain("## uidotsh://ui/componentize");
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
