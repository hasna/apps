import { describe, test, expect, beforeEach } from "bun:test";
import { checkAction, resetRateLimiter } from "../src/agent/safety.js";
import type { SafetyConfig, DriverAction } from "../src/types/index.js";

const DEFAULT_SAFETY: SafetyConfig = {
  blockedApps: ["Keychain Access"],
  blockedDomains: ["bank.example.com", "paypal.com"],
  confirmClicks: false,
  maxActionsPerMinute: 60,
  allowPasswordTyping: false,
};

describe("safety", () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  // ── App blocklist ──
  test("blocks Keychain Access", () => {
    const result = checkAction({ type: "open_app", name: "Keychain Access" }, DEFAULT_SAFETY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Blocked app");
  });

  test("blocks case-insensitive app match", () => {
    const result = checkAction({ type: "open_app", name: "keychain access" }, DEFAULT_SAFETY);
    expect(result.allowed).toBe(false);
  });

  test("allows non-blocked apps", () => {
    const result = checkAction({ type: "open_app", name: "Safari" }, DEFAULT_SAFETY);
    expect(result.allowed).toBe(true);
  });

  test("blocks default apps (1Password, etc.)", () => {
    const result = checkAction({ type: "open_app", name: "1Password" }, DEFAULT_SAFETY);
    expect(result.allowed).toBe(false);
  });

  // ── Domain blocklist ──
  test("blocks exact domain match", () => {
    const result = checkAction({ type: "open_url", url: "https://bank.example.com/login" }, DEFAULT_SAFETY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Blocked domain");
  });

  test("blocks subdomain of blocked domain", () => {
    const result = checkAction({ type: "open_url", url: "https://www.paypal.com/checkout" }, DEFAULT_SAFETY);
    expect(result.allowed).toBe(false);
  });

  test("allows non-blocked domains", () => {
    const result = checkAction({ type: "open_url", url: "https://github.com" }, DEFAULT_SAFETY);
    expect(result.allowed).toBe(true);
  });

  test("handles invalid URLs gracefully", () => {
    const result = checkAction({ type: "open_url", url: "not-a-url" }, DEFAULT_SAFETY);
    expect(result.allowed).toBe(true);
  });

  // ── Rate limiting ──
  test("allows actions within rate limit", () => {
    for (let i = 0; i < 5; i++) {
      const result = checkAction({ type: "screenshot" }, DEFAULT_SAFETY);
      expect(result.allowed).toBe(true);
    }
  });

  test("blocks when rate limit exceeded", () => {
    const config: SafetyConfig = { ...DEFAULT_SAFETY, maxActionsPerMinute: 3 };
    checkAction({ type: "screenshot" }, config);
    checkAction({ type: "screenshot" }, config);
    checkAction({ type: "screenshot" }, config);
    const result = checkAction({ type: "screenshot" }, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Rate limit");
  });

  // ── Click confirmation ──
  test("no confirmation when confirmClicks is false", () => {
    const result = checkAction(
      { type: "click", point: { x: 100, y: 200 } },
      { ...DEFAULT_SAFETY, confirmClicks: false }
    );
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  test("requires confirmation when confirmClicks is true", () => {
    const result = checkAction(
      { type: "click", point: { x: 100, y: 200 } },
      { ...DEFAULT_SAFETY, confirmClicks: true }
    );
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });

  // ── Password detection ──
  test("flags password-like text with confirmClicks", () => {
    const result = checkAction(
      { type: "type", text: "P@ssw0rd123!" },
      { ...DEFAULT_SAFETY, confirmClicks: true, allowPasswordTyping: false }
    );
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });

  test("allows normal text typing", () => {
    const result = checkAction(
      { type: "type", text: "Hello, how are you today?" },
      { ...DEFAULT_SAFETY, confirmClicks: true }
    );
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  // ── Dangerous key combos ──
  test("flags cmd+shift+delete", () => {
    const result = checkAction(
      { type: "key", keys: "cmd+shift+delete" },
      DEFAULT_SAFETY
    );
    expect(result.requiresConfirmation).toBe(true);
  });

  test("allows normal key combos", () => {
    const result = checkAction(
      { type: "key", keys: "cmd+c" },
      DEFAULT_SAFETY
    );
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  // ── Other actions ──
  test("allows scroll actions", () => {
    const result = checkAction(
      { type: "scroll", point: { x: 500, y: 300 }, deltaX: 0, deltaY: 3 },
      DEFAULT_SAFETY
    );
    expect(result.allowed).toBe(true);
  });

  test("allows mouse move", () => {
    const result = checkAction(
      { type: "mouse_move", point: { x: 100, y: 200 } },
      DEFAULT_SAFETY
    );
    expect(result.allowed).toBe(true);
  });

  test("allows wait", () => {
    const result = checkAction(
      { type: "wait", ms: 1000 },
      DEFAULT_SAFETY
    );
    expect(result.allowed).toBe(true);
  });
});
