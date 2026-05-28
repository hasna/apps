import { describe, test, expect } from "bun:test";
import { parseTmuxTarget, calculateDelay, formatTmuxTarget, DELAY_MIN, DELAY_MAX } from "./tmux.ts";

describe("parseTmuxTarget", () => {
  test("parses bare window name", () => {
    const t = parseTmuxTarget("main");
    expect(t.session).toBeNull();
    expect(t.window).toBe("main");
    expect(t.pane).toBeNull();
    expect(t.raw).toBe("main");
  });

  test("parses session:window", () => {
    const t = parseTmuxTarget("work:editor");
    expect(t.session).toBe("work");
    expect(t.window).toBe("editor");
    expect(t.pane).toBeNull();
  });

  test("parses session:window.pane", () => {
    const t = parseTmuxTarget("work:1.0");
    expect(t.session).toBe("work");
    expect(t.window).toBe("1");
    expect(t.pane).toBe("0");
  });

  test("parses numeric window", () => {
    const t = parseTmuxTarget("2");
    expect(t.session).toBeNull();
    expect(t.window).toBe("2");
    expect(t.pane).toBeNull();
  });

  test("parses window.pane without session", () => {
    const t = parseTmuxTarget("editor.1");
    expect(t.session).toBeNull();
    expect(t.window).toBe("editor");
    expect(t.pane).toBe("1");
  });

  test("throws on empty string", () => {
    expect(() => parseTmuxTarget("")).toThrow("cannot be empty");
  });

  test("throws on whitespace only", () => {
    expect(() => parseTmuxTarget("   ")).toThrow("cannot be empty");
  });

  test("throws when window is empty after colon", () => {
    expect(() => parseTmuxTarget("session:")).toThrow("window part is missing");
  });
});

describe("formatTmuxTarget", () => {
  test("formats bare window", () => {
    expect(formatTmuxTarget({ session: null, window: "main", pane: null, raw: "main" })).toBe("main");
  });

  test("formats session:window", () => {
    expect(formatTmuxTarget({ session: "work", window: "editor", pane: null, raw: "work:editor" })).toBe("work:editor");
  });

  test("formats session:window.pane", () => {
    expect(formatTmuxTarget({ session: "work", window: "1", pane: "0", raw: "work:1.0" })).toBe("work:1.0");
  });

  test("formats window.pane without session", () => {
    expect(formatTmuxTarget({ session: null, window: "editor", pane: "1", raw: "editor.1" })).toBe("editor.1");
  });
});

describe("calculateDelay", () => {
  test("empty message returns DELAY_MIN", () => {
    expect(calculateDelay("")).toBe(DELAY_MIN);
  });

  test("empty string returns DELAY_MIN", () => {
    expect(calculateDelay("")).toBe(DELAY_MIN);
  });

  test("very long message is capped at DELAY_MAX", () => {
    const long = "x".repeat(10_000);
    expect(calculateDelay(long)).toBe(DELAY_MAX);
  });

  test("medium message is between DELAY_MIN and DELAY_MAX", () => {
    const mid = "x".repeat(500); // 500 chars → 3000 + floor(5 * 40) = 3200ms
    const delay = calculateDelay(mid);
    expect(delay).toBeGreaterThanOrEqual(DELAY_MIN);
    expect(delay).toBeLessThanOrEqual(DELAY_MAX);
  });

  test("delay scales with message length", () => {
    const short = calculateDelay("x".repeat(100));
    const longer = calculateDelay("x".repeat(1000));
    expect(longer).toBeGreaterThan(short);
  });

  test("100-char message adds exactly 40ms over DELAY_MIN", () => {
    const msg = "x".repeat(100);
    expect(calculateDelay(msg)).toBe(DELAY_MIN + 40);
  });
});
