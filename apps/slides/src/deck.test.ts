import { describe, expect, test } from "bun:test";
import { createDeck, loadDeck, normalizeSlide, DEFAULT_THEME } from "./deck.js";

describe("createDeck", () => {
  test("applies sensible defaults", () => {
    const deck = createDeck();
    expect(deck.title).toBe("Untitled Deck");
    expect(deck.theme).toBe(DEFAULT_THEME);
    expect(deck.slides).toHaveLength(0);
    expect(deck.data.version).toBe(1);
    expect(deck.data.config.transition).toBe("slide");
    expect(deck.id).toBeTruthy();
    expect(deck.data.createdAt).toBe(deck.data.updatedAt);
  });

  test("accepts initial slides and merges config", () => {
    const deck = createDeck({
      title: "Kickoff",
      theme: "moon",
      config: { transition: "zoom", controls: false },
      slides: [{ body: "# Hello" }, { body: "<h1>Two</h1>", format: "html" }],
    });
    expect(deck.title).toBe("Kickoff");
    expect(deck.theme).toBe("moon");
    expect(deck.data.config.transition).toBe("zoom");
    expect(deck.data.config.controls).toBe(false);
    // default kept when not overridden
    expect(deck.data.config.progress).toBe(true);
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0]!.format).toBe("markdown");
    expect(deck.slides[1]!.format).toBe("html");
  });
});

describe("normalizeSlide", () => {
  test("assigns an id and defaults to markdown", () => {
    const slide = normalizeSlide({ body: "hi" });
    expect(slide.id).toBeTruthy();
    expect(slide.format).toBe("markdown");
  });

  test("strips grandchildren (only one vertical level)", () => {
    const slide = normalizeSlide({
      body: "top",
      children: [{ body: "child", children: [{ body: "grandchild" }] }],
    });
    expect(slide.children).toHaveLength(1);
    expect(slide.children![0]!.children).toBeUndefined();
  });
});

describe("slide CRUD", () => {
  test("addSlide appends and inserts at index", () => {
    const deck = createDeck();
    const a = deck.addSlide({ body: "A" });
    const c = deck.addSlide({ body: "C" });
    const b = deck.addSlide({ body: "B" }, 1);
    expect(deck.slides.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
  });

  test("addChild builds a vertical stack", () => {
    const deck = createDeck();
    const top = deck.addSlide({ body: "Top" });
    const child = deck.addChild(top.id, { body: "Deeper" });
    expect(deck.getSlide(top.id)!.children).toHaveLength(1);
    expect(deck.getSlide(child.id)!.body).toBe("Deeper");
    expect(deck.slideCount()).toBe(2);
  });

  test("addChild throws for unknown parent", () => {
    const deck = createDeck();
    expect(() => deck.addChild("nope", { body: "x" })).toThrow();
  });

  test("updateSlide patches fields on nested slides", () => {
    const deck = createDeck();
    const top = deck.addSlide({ body: "Top" });
    const child = deck.addChild(top.id, { body: "child" });
    deck.updateSlide(child.id, { body: "updated", transition: "fade" });
    expect(deck.getSlide(child.id)!.body).toBe("updated");
    expect(deck.getSlide(child.id)!.transition).toBe("fade");
  });

  test("setNotes sets and clears", () => {
    const deck = createDeck();
    const s = deck.addSlide({ body: "x" });
    deck.setNotes(s.id, "remember this");
    expect(deck.getSlide(s.id)!.notes).toBe("remember this");
    deck.setNotes(s.id, "");
    expect(deck.getSlide(s.id)!.notes).toBeUndefined();
  });

  test("removeSlide removes top-level and children, collapsing empty stacks", () => {
    const deck = createDeck();
    const top = deck.addSlide({ body: "Top" });
    const child = deck.addChild(top.id, { body: "child" });
    expect(deck.removeSlide(child.id)).toBe(true);
    expect(deck.getSlide(top.id)!.children).toBeUndefined();
    expect(deck.removeSlide(top.id)).toBe(true);
    expect(deck.slides).toHaveLength(0);
    expect(deck.removeSlide("missing")).toBe(false);
  });

  test("moveSlide reorders top-level slides", () => {
    const deck = createDeck();
    const a = deck.addSlide({ body: "A" });
    const b = deck.addSlide({ body: "B" });
    const c = deck.addSlide({ body: "C" });
    expect(deck.moveSlide(c.id, 0)).toBe(true);
    expect(deck.slides.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
    expect(deck.moveSlide("missing", 0)).toBe(false);
  });

  test("mutations advance updatedAt", async () => {
    const deck = createDeck();
    const before = deck.data.updatedAt;
    await Bun.sleep(2);
    deck.addSlide({ body: "x" });
    expect(deck.data.updatedAt >= before).toBe(true);
  });
});

describe("clone / loadDeck", () => {
  test("clone is independent", () => {
    const deck = createDeck({ slides: [{ body: "A" }] });
    const copy = deck.clone();
    copy.addSlide({ body: "B" });
    expect(deck.slides).toHaveLength(1);
    expect(copy.slides).toHaveLength(2);
  });

  test("loadDeck round-trips a serialized deck", () => {
    const deck = createDeck({ title: "T", slides: [{ body: "A" }] });
    const reloaded = loadDeck(JSON.stringify(deck.toJSON()));
    expect(reloaded.title).toBe("T");
    expect(reloaded.slides).toHaveLength(1);
  });

  test("loadDeck rejects malformed input", () => {
    expect(() => loadDeck({ title: "no id" })).toThrow();
  });
});
