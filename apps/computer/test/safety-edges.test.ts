// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { beforeEach, describe, expect, test } from "bun:test";
import { checkAction, resetRateLimiter } from "../src/agent/safety.js";
import type { SafetyConfig } from "../src/types/index.js";

const BASE: SafetyConfig = {
  blockedApps: ["Keychain Access"],
  blockedDomains: ["bank.example.com", "paypal.com"],
  confirmClicks: false,
  maxActionsPerMinute: 60,
  allowPasswordTyping: false,
};

describe("safety edges — app blocklist", () => {
  beforeEach(() => resetRateLimiter());

  test("blocks app names that merely contain a blocked entry (helper processes)", () => {
    const result = checkAction(
      { type: "open_app", name: "Keychain Access Helper" },
      BASE
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Keychain Access");
  });

  test("blocks apps from config that are not in the built-in list", () => {
    const config: SafetyConfig = { ...BASE, blockedApps: ["Figma"] };
    expect(checkAction({ type: "open_app", name: "Figma" }, config).allowed).toBe(false);
    // built-ins still blocked alongside config entries
    expect(checkAction({ type: "open_app", name: "1Password" }, config).allowed).toBe(false);
  });

  test("empty app name is not blocked", () => {
    const result = checkAction({ type: "open_app", name: "" }, BASE);
    expect(result.allowed).toBe(true);
  });
});

describe("safety edges — domain blocklist", () => {
  beforeEach(() => resetRateLimiter());

  test("blocks the exact hostname even with a port", () => {
    const result = checkAction(
      { type: "open_url", url: "https://paypal.com:8443/checkout" },
      BASE
    );
    expect(result.allowed).toBe(false);
  });

  test("blocks uppercase hostnames (hostname is lowercased)", () => {
    const result = checkAction({ type: "open_url", url: "https://PAYPAL.COM/checkout" }, BASE);
    expect(result.allowed).toBe(false);
  });

  test("allows a lookalike domain that is not a subdomain of the blocked entry", () => {
    // paypal.com.evil.com is NOT a subdomain of paypal.com — must pass
    const result = checkAction({ type: "open_url", url: "https://paypal.com.evil.com/x" }, BASE);
    expect(result.allowed).toBe(true);
  });

  test("blocks one-level subdomains", () => {
    const result = checkAction({ type: "open_url", url: "https://secure.bank.example.com/login" }, BASE);
    expect(result.allowed).toBe(false);
  });

  test("allows a bare hostname that merely ends with the blocked suffix but is not dot-delimited", () => {
    // notpaypal.com does not end with ".paypal.com" — must pass
    const result = checkAction({ type: "open_url", url: "https://notpaypal.com" }, BASE);
    expect(result.allowed).toBe(true);
  });

  test("javascript: URLs parse with empty hostname and are allowed", () => {
    const result = checkAction({ type: "open_url", url: "javascript:alert(1)" }, BASE);
    expect(result.allowed).toBe(true);
  });

  test("blockedDomains undefined means nothing is blocked", () => {
    const config: SafetyConfig = { ...BASE, blockedDomains: undefined };
    const result = checkAction({ type: "open_url", url: "https://paypal.com" }, config);
    expect(result.allowed).toBe(true);
  });
});

describe("safety edges — key combos", () => {
  beforeEach(() => resetRateLimiter());

  test("flags cmd+option+escape (force quit)", () => {
    const result = checkAction({ type: "key", keys: "cmd+option+escape" }, BASE);
    expect(result.requiresConfirmation).toBe(true);
  });

  test("flags key combos with whitespace variants", () => {
    const result = checkAction({ type: "key", keys: "cmd + shift + delete" }, BASE);
    expect(result.requiresConfirmation).toBe(true);
  });

  test("does not flag combos that merely contain a dangerous prefix", () => {
    const result = checkAction({ type: "key", keys: "cmd+shift+deletefile" }, BASE);
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBeUndefined();
  });
});

describe("safety edges — password heuristic", () => {
  beforeEach(() => resetRateLimiter());

  const confirm: SafetyConfig = { ...BASE, confirmClicks: true };

  test("flags exactly 3 character classes (upper+lower+digit)", () => {
    const result = checkAction({ type: "type", text: "Ab1def" }, confirm);
    expect(result.requiresConfirmation).toBe(true);
  });

  test("flags 4 character classes", () => {
    const result = checkAction({ type: "type", text: "P@ssw0rd" }, confirm);
    expect(result.requiresConfirmation).toBe(true);
  });

  test("does not flag 2 character classes", () => {
    const result = checkAction({ type: "type", text: "abcdef123" }, confirm);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  test("does not flag text shorter than 6 chars", () => {
    const result = checkAction({ type: "type", text: "Ab1!" }, confirm);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  test("does not flag text longer than 50 chars", () => {
    const result = checkAction({ type: "type", text: "Ab1!".repeat(20) }, confirm);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  test("does not flag sentences (more than 3 words)", () => {
    const result = checkAction({ type: "type", text: "the quick brown fox jumps" }, confirm);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  test("allowPasswordTyping: true suppresses the password flag entirely", () => {
    const config: SafetyConfig = { ...confirm, allowPasswordTyping: true };
    const result = checkAction({ type: "type", text: "P@ssw0rd" }, config);
    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  test("confirmClicks: false never flags typing", () => {
    const result = checkAction({ type: "type", text: "P@ssw0rd" }, BASE);
    expect(result.requiresConfirmation).toBeUndefined();
  });
});

describe("safety edges — rate limiter", () => {
  beforeEach(() => resetRateLimiter());

  test("maxActionsPerMinute 0 blocks every action", () => {
    const config: SafetyConfig = { ...BASE, maxActionsPerMinute: 0 };
    const result = checkAction({ type: "screenshot" }, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Rate limit");
  });

  test("maxActionsPerMinute 1 allows exactly one action", () => {
    const config: SafetyConfig = { ...BASE, maxActionsPerMinute: 1 };
    expect(checkAction({ type: "screenshot" }, config).allowed).toBe(true);
    expect(checkAction({ type: "screenshot" }, config).allowed).toBe(false);
  });

  test("default maxActionsPerMinute when unset is 60", () => {
    const config: SafetyConfig = { ...BASE, maxActionsPerMinute: undefined };
    for (let i = 0; i < 60; i++) {
      expect(checkAction({ type: "screenshot" }, config).allowed).toBe(true);
    }
    expect(checkAction({ type: "screenshot" }, config).allowed).toBe(false);
  });

  test("blocked actions still consume the rate budget (checked before switch)", () => {
    const config: SafetyConfig = { ...BASE, maxActionsPerMinute: 1 };
    expect(checkAction({ type: "open_app", name: "Keychain Access" }, config).allowed).toBe(false);
    expect(checkAction({ type: "open_app", name: "Safari" }, config).allowed).toBe(false);
  });
});

describe("safety edges — misc actions", () => {
  beforeEach(() => resetRateLimiter());

  test("unknown action type defaults to allowed", () => {
    const result = checkAction({ type: "beep" } as any, BASE);
    expect(result.allowed).toBe(true);
  });

  test("drag passes through without confirmation", () => {
    const result = checkAction(
      { type: "drag", from: { x: 1, y: 2 }, to: { x: 3, y: 4 } },
      BASE
    );
    expect(result.allowed).toBe(true);
  });
});
