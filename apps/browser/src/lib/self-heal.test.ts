/**
 * Tests for self-healing selector resolution (src/lib/self-heal.ts).
 * Exercises the full fallback cascade against a mock page: original
 * selector, text match, role+name match, partial id, partial class, then
 * give-up — including the metadata each strategy must report and the
 * attempt log the cascade leaves behind.
 */
import { describe, expect, it } from "bun:test";
import { healSelector } from "./self-heal.js";
import type { Page } from "playwright";

interface LocatorMock {
  count: () => Promise<number>;
}

function makeLocator(hits: boolean): LocatorMock {
  return { count: async () => (hits ? 1 : 0) };
}

interface PageMockOpts {
  /** CSS selectors (page.locator) that resolve */
  cssHits?: string[];
  /** exact-ish text the page.getByText resolves */
  textHits?: string[];
  /** roles that resolve, e.g. "button" */
  roleHits?: string[];
}

function makePage(opts: PageMockOpts): Page {
  const css = new Set(opts.cssHits ?? []);
  const texts = new Set(opts.textHits ?? []);
  const roles = new Set(opts.roleHits ?? []);

  const page = {
    locator: (sel: string) => ({ first: () => makeLocator(css.has(sel)) }),
    getByText: (text: string) => ({ first: () => makeLocator(texts.has(text)) }),
    getByRole: (role: string) => ({ first: () => makeLocator(roles.has(role)) }),
  };
  return page as unknown as Page;
}

describe("healSelector — original selector hit", () => {
  it("returns the original locator with healed=false and no fallback attempts beyond the first", async () => {
    const page = makePage({ cssHits: ["#submit-btn"] });
    const result = await healSelector(page, "#submit-btn");
    expect(result.found).toBe(true);
    expect(result.method).toBe("original");
    expect(result.healed).toBe(false);
    expect(result.locator).not.toBeNull();
    expect(result.attempts).toEqual(["selector: #submit-btn"]);
  });
});

describe("healSelector — fallback cascade", () => {
  it("falls back to a text match for plain single-word selectors", async () => {
    const page = makePage({ cssHits: [], textHits: ["Save"] });
    const result = await healSelector(page, "Save");
    expect(result.found).toBe(true);
    expect(result.method).toBe("text");
    expect(result.healed).toBe(true);
    expect(result.attempts[0]).toBe("selector: Save");
    expect(result.attempts[1]).toContain('text: "Save"');
  });

  it("falls back to a role+name match when selector looks like a button id", async () => {
    const page = makePage({ cssHits: [], roleHits: ["button"] });
    const result = await healSelector(page, "#submit-btn");
    expect(result.found).toBe(true);
    expect(result.method).toBe("role");
    expect(result.healed).toBe(true);
  });

  it("uses partial id match for #-selectors whose full id is gone", async () => {
    const page = makePage({ cssHits: ['[id*="submit"]'] });
    const result = await healSelector(page, "#old-submit");
    expect(result.found).toBe(true);
    expect(result.method).toBe("partial_id");
    expect(result.healed).toBe(true);
    expect(result.attempts).toContain('partial_id: [id*="submit"]');
  });

  it("uses partial class match for .-selectors whose full class is gone", async () => {
    const page = makePage({ cssHits: ['[class*="card"]'] });
    const result = await healSelector(page, ".product-card");
    expect(result.found).toBe(true);
    expect(result.method).toBe("partial_class");
    expect(result.healed).toBe(true);
    expect(result.attempts).toContain('partial_class: [class*="card"]');
  });

  it("skips the text fallback for selectors that contain a space", async () => {
    // The text branch only runs for plain single-word selectors
    const page = makePage({ cssHits: ['[id*="submit"]'] });
    const result = await healSelector(page, "#very-old-submit");
    expect(result.found).toBe(true);
    expect(result.method).toBe("partial_id");
    const textAttempt = result.attempts.find(a => a.startsWith('text:'));
    expect(textAttempt).toBeUndefined();
  });
});

describe("healSelector — give-up", () => {
  it("returns found=false with the full attempt log when nothing matches", async () => {
    const page = makePage({ cssHits: [], textHits: [], roleHits: [] });
    const result = await healSelector(page, "#nope-nowhere");
    expect(result.found).toBe(false);
    expect(result.method).toBe("none");
    expect(result.healed).toBe(false);
    expect(result.locator).toBeNull();
    expect(result.attempts.length).toBeGreaterThanOrEqual(3);
    expect(result.attempts[0]).toBe("selector: #nope-nowhere");
  });

  it("records every strategy in order for a total miss on a plain-word selector", async () => {
    const page = makePage({ cssHits: [], textHits: [], roleHits: [] });
    const result = await healSelector(page, "vanished");
    expect(result.found).toBe(false);
    expect(result.attempts[0]).toBe("selector: vanished");
    expect(result.attempts[1]).toContain('text: "vanished"');
    expect(result.attempts.some(a => a.startsWith("role:"))).toBe(true);
  });
});

describe("healSelector — tolerant of throwing page mocks", () => {
  it("does not throw when the underlying page APIs fail", async () => {
    const page = {
      locator: () => { throw new Error("boom"); },
      getByText: () => { throw new Error("boom"); },
      getByRole: () => { throw new Error("boom"); },
    } as unknown as Page;
    const result = await healSelector(page, "anything");
    expect(result.found).toBe(false);
    expect(result.method).toBe("none");
  });
});
