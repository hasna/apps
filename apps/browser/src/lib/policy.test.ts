import { describe, expect, it } from "bun:test";
import {
  BROWSER_ALLOWED_DOMAINS_ENV,
  BROWSER_ALLOW_RISKY_CAPABILITIES_ENV,
  BROWSER_CAPABILITY_TOKEN_ENV,
  assertBrowserCapability,
  assertBrowserNavigationAllowed,
  isBrowserCapabilityApproved,
} from "./policy.js";

describe("browser capability policy", () => {
  it("denies risky capabilities by default", () => {
    expect(isBrowserCapabilityApproved("cdp_attach", { env: {} })).toBe(false);
    expect(() => assertBrowserCapability("cdp_attach", { env: {} })).toThrow(/requires operator approval/);
  });

  it("allows explicit trusted local opt-in", () => {
    expect(isBrowserCapabilityApproved("tui_launch", {
      env: { [BROWSER_ALLOW_RISKY_CAPABILITIES_ENV]: "1" },
    })).toBe(true);
  });

  it("requires matching approval token when token mode is configured", () => {
    const env = {
      [BROWSER_ALLOW_RISKY_CAPABILITIES_ENV]: "1",
      [BROWSER_CAPABILITY_TOKEN_ENV]: "secret",
    };

    expect(isBrowserCapabilityApproved("storage_state", { env })).toBe(false);
    expect(isBrowserCapabilityApproved("storage_state", { env, approvalToken: "wrong" })).toBe(false);
    expect(isBrowserCapabilityApproved("storage_state", { env, approvalToken: "secret" })).toBe(true);
  });

  it("blocks non-allowlisted domains when an allowlist is configured", () => {
    const env = { [BROWSER_ALLOWED_DOMAINS_ENV]: "example.test,localhost" };

    expect(() => assertBrowserNavigationAllowed("https://app.example.test/path", { env })).not.toThrow();
    expect(() => assertBrowserNavigationAllowed("http://localhost:7030", { env })).not.toThrow();
    expect(() => assertBrowserNavigationAllowed("https://evil.test", { env })).toThrow(/not in BROWSER_ALLOWED_DOMAINS/);
  });
});
