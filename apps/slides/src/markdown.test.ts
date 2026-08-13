import { describe, expect, test } from "bun:test";
import { parseMarkdownDeck, slidesToMarkdown } from "./markdown.js";
import { createDeck } from "./deck.js";

describe("parseMarkdownDeck", () => {
  test("splits horizontal slides on ---", () => {
    const slides = parseMarkdownDeck("# One\n\n---\n\n# Two\n\n---\n\n# Three");
    expect(slides).toHaveLength(3);
    expect(slides[0]!.body).toBe("# One");
    expect(slides[2]!.body).toBe("# Three");
    expect(slides[0]!.format).toBe("markdown");
  });

  test("splits vertical sub-slides on --", () => {
    const slides = parseMarkdownDeck("# Top\n\n--\n\n## Sub A\n\n--\n\n## Sub B\n\n---\n\n# Next");
    expect(slides).toHaveLength(2);
    expect(slides[0]!.children).toHaveLength(2);
    expect(slides[0]!.children![0]!.body).toBe("## Sub A");
    expect(slides[1]!.children).toBeUndefined();
  });

  test("extracts speaker notes via Note:", () => {
    const slides = parseMarkdownDeck("# Slide\n\nbody text\n\nNote: say this out loud");
    expect(slides[0]!.body).toBe("# Slide\n\nbody text");
    expect(slides[0]!.notes).toBe("say this out loud");
  });

  test("multi-line notes run to end of slide", () => {
    const slides = parseMarkdownDeck("# S\n\nNote:\nline one\nline two\n\n---\n\n# Next");
    expect(slides[0]!.notes).toBe("line one\nline two");
    expect(slides[1]!.body).toBe("# Next");
  });

  test("ignores empty trailing slides", () => {
    const slides = parseMarkdownDeck("# Only\n\n---\n\n   \n");
    expect(slides).toHaveLength(1);
  });
});

describe("slidesToMarkdown", () => {
  test("round-trips a markdown deck structure", () => {
    const source = "# One\n\nbody\n\nNote: hi\n\n---\n\n# Two\n\n--\n\n## Two.1";
    const parsed = parseMarkdownDeck(source);
    const deck = createDeck({ slides: parsed });
    const roundTrip = parseMarkdownDeck(slidesToMarkdown(deck.slides));
    expect(roundTrip[0]!.body).toBe("# One\n\nbody");
    expect(roundTrip[0]!.notes).toBe("hi");
    expect(roundTrip[1]!.children![0]!.body).toBe("## Two.1");
  });
});
