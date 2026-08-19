/**
 * Tests for tab management (src/lib/tabs.ts) against a mock Playwright
 * context — no real browser required. Covers index bookkeeping, active-tab
 * semantics, out-of-range guards, the last-tab guard, and tolerance of
 * closed/navigating pages.
 */
import { describe, expect, it } from "bun:test";
import { newTab, listTabs, switchTab, closeTab } from "./tabs.js";
import type { Page } from "playwright";

interface MockContext {
  pages: () => MockPage[];
  newPage: (opts?: unknown) => Promise<MockPage>;
}

interface MockPage {
  url: () => string;
  title: () => Promise<string>;
  context: () => MockContext;
  bringToFront: () => Promise<void>;
  close: () => Promise<void>;
  goto?: (url: string, opts?: unknown) => Promise<unknown>;
}

function makeContext(): MockContext {
  const pages: MockPage[] = [];
  const ctx: MockContext = {
    pages: () => pages,
    async newPage() {
      const p = makePage({ url: "about:blank", title: "", ctx });
      pages.push(p);
      return p;
    },
  };
  return ctx;
}

function makePage(opts: { url: string; title: string; ctx: MockContext }): MockPage {
  const page: MockPage = {
    url: () => opts.url,
    title: async () => opts.title,
    context: () => opts.ctx,
    bringToFront: async () => {},
    close: async () => {
      const i = opts.ctx.pages().indexOf(page);
      if (i >= 0) opts.ctx.pages().splice(i, 1);
    },
  };
  return page;
}

function ctxWithPages(urls: Array<{ url: string; title: string }>): MockContext {
  const ctx = makeContext();
  for (const spec of urls) {
    ctx.pages().push(makePage({ url: spec.url, title: spec.title, ctx }));
  }
  return ctx;
}

function viewOf(page: MockPage): Page {
  return page as unknown as Page;
}

describe("newTab", () => {
  it("creates a tab at the end of the context and marks it active", async () => {
    const ctx = ctxWithPages([{ url: "https://a.example/", title: "A" }]);
    const created = await newTab(viewOf(ctx.pages()[0]));
    expect(ctx.pages()).toHaveLength(2);
    expect(created.index).toBe(1);
    expect(created.is_active).toBe(true);
    expect(created.url).toBe("about:blank");
  });

  it("navigates to the given URL when provided", async () => {
    const ctx = ctxWithPages([{ url: "https://a.example/", title: "A" }]);
    const original = ctx.newPage;
    ctx.newPage = async () => {
      const p = makePage({ url: "about:blank", title: "", ctx });
      p.goto = async (url: string) => { p.url = () => url; return null; };
      ctx.pages().push(p);
      return p;
    };
    const created = await newTab(viewOf(ctx.pages()[0]), "https://target.example/deep");
    expect(original).toBeDefined(); // keep the type checker honest about the override
    expect(created.url).toBe("https://target.example/deep");
  });
});

describe("listTabs", () => {
  it("lists all pages with correct indices and the caller marked active", async () => {
    const ctx = ctxWithPages([
      { url: "https://a.example/", title: "A" },
      { url: "https://b.example/", title: "B" },
      { url: "https://c.example/", title: "C" },
    ]);
    const tabs = await listTabs(viewOf(ctx.pages()[1]));
    expect(tabs).toHaveLength(3);
    expect(tabs.map(t => t.url)).toEqual(["https://a.example/", "https://b.example/", "https://c.example/"]);
    expect(tabs.map(t => t.is_active)).toEqual([false, true, false]);
  });

  it("tolerates closed/navigating pages by falling back to empty url/title", async () => {
    const ctx = makeContext();
    ctx.pages().push(makePage({ url: "https://a.example/", title: "A", ctx }));
    const dead = makePage({ url: "https://dead.example/", title: "Dead", ctx });
    dead.url = () => { throw new Error("Page closed"); };
    dead.title = async () => { throw new Error("Page closed"); };
    ctx.pages().push(dead);

    const tabs = await listTabs(viewOf(ctx.pages()[0]));
    expect(tabs[0].url).toBe("https://a.example/");
    expect(tabs[1].url).toBe("");
    expect(tabs[1].title).toBe("");
    expect(tabs[1].is_active).toBe(false);
  });
});

describe("switchTab", () => {
  it("switches to a valid index and reports it active", async () => {
    const ctx = ctxWithPages([
      { url: "https://a.example/", title: "A" },
      { url: "https://b.example/", title: "B" },
    ]);
    const switched = await switchTab(viewOf(ctx.pages()[0]), 1);
    expect(switched.tab.index).toBe(1);
    expect(switched.tab.url).toBe("https://b.example/");
    expect(switched.tab.is_active).toBe(true);
  });

  it("throws for a negative index", async () => {
    const ctx = ctxWithPages([{ url: "https://a.example/", title: "A" }]);
    expect(switchTab(viewOf(ctx.pages()[0]), -1)).rejects.toThrow(/out of range/);
  });

  it("throws for an index past the end", async () => {
    const ctx = ctxWithPages([{ url: "https://a.example/", title: "A" }]);
    expect(switchTab(viewOf(ctx.pages()[0]), 3)).rejects.toThrow(/out of range/);
  });
});

describe("closeTab", () => {
  it("closes a non-active tab and keeps the caller active", async () => {
    const ctx = ctxWithPages([
      { url: "https://a.example/", title: "A" },
      { url: "https://b.example/", title: "B" },
      { url: "https://c.example/", title: "C" },
    ]);
    const result = await closeTab(viewOf(ctx.pages()[0]), 1);
    expect(result.closed_index).toBe(1);
    expect(ctx.pages()).toHaveLength(2);
    expect(result.active_tab.index).toBe(0); // caller (index 0) remains active
    expect(result.active_tab.url).toBe("https://a.example/");
  });

  it("when closing the active tab, the next tab takes over", async () => {
    const ctx = ctxWithPages([
      { url: "https://a.example/", title: "A" },
      { url: "https://b.example/", title: "B" },
      { url: "https://c.example/", title: "C" },
    ]);
    const result = await closeTab(viewOf(ctx.pages()[1]), 1);
    expect(result.closed_index).toBe(1);
    expect(result.active_tab.index).toBe(1); // min(1, remaining-1=1)
    expect(result.active_tab.url).toBe("https://c.example/");
  });

  it("when closing the LAST active tab, the previous tab takes over", async () => {
    const ctx = ctxWithPages([
      { url: "https://a.example/", title: "A" },
      { url: "https://b.example/", title: "B" },
    ]);
    const result = await closeTab(viewOf(ctx.pages()[1]), 1);
    expect(result.closed_index).toBe(1);
    expect(ctx.pages()).toHaveLength(1);
    expect(result.active_tab.index).toBe(0);
    expect(result.active_tab.url).toBe("https://a.example/");
  });

  it("refuses to close the last remaining tab", async () => {
    const ctx = ctxWithPages([{ url: "https://a.example/", title: "A" }]);
    expect(closeTab(viewOf(ctx.pages()[0]), 0)).rejects.toThrow(/last tab/);
  });

  it("throws for an out-of-range index", async () => {
    const ctx = ctxWithPages([{ url: "https://a.example/", title: "A" }]);
    expect(closeTab(viewOf(ctx.pages()[0]), 5)).rejects.toThrow(/out of range/);
  });
});
