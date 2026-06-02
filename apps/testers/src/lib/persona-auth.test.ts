import { describe, expect, test } from "bun:test";
import type { Persona } from "../types/index.js";
import { hasFreshAuthCookies, isPrimarySessionCookie, isSessionCookie } from "./persona-auth.js";

describe("persona auth cookie classification", () => {
  test("does not treat CSRF cookies as authenticated sessions", () => {
    expect(isSessionCookie("csrfToken")).toBe(false);
    expect(isSessionCookie("XSRF-TOKEN")).toBe(false);
  });

  test("treats ordinary app cookies as session evidence", () => {
    expect(isSessionCookie("accessToken")).toBe(true);
    expect(isSessionCookie("refreshToken")).toBe(true);
  });

  test("does not treat refresh cookies as primary session evidence", () => {
    expect(isPrimarySessionCookie("accessToken")).toBe(true);
    expect(isPrimarySessionCookie("refreshToken")).toBe(false);
  });
});

describe("persona auth cookie freshness", () => {
  function personaWithCookies(cookies: Record<string, unknown>[], updatedAt = new Date().toISOString()): Persona {
    return {
      id: "persona-1",
      shortId: "p1",
      projectId: null,
      name: "QA",
      description: "",
      role: "tester",
      instructions: "",
      traits: [],
      goals: [],
      behaviors: [],
      expertiseLevel: "intermediate",
      demographics: {},
      painPoints: [],
      metadata: null,
      enabled: true,
      version: 1,
      createdAt: updatedAt,
      updatedAt,
      auth: {
        email: "qa@example.test",
        password: "secret",
        loginPath: "/auth/login",
        strategy: "form-login",
        cookies,
      },
    };
  }

  test("does not trust expired session cookies just because the persona was recently updated", () => {
    const expired = Math.floor(Date.now() / 1000) - 60;
    const persona = personaWithCookies([
      { name: "csrfToken", value: "csrf", expires: -1 },
      { name: "accessToken", value: "expired-access", expires: expired },
      { name: "refreshToken", value: "expired-refresh", expires: expired },
    ]);

    expect(hasFreshAuthCookies(persona)).toBe(false);
  });

  test("trusts a future-expiring session cookie", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const persona = personaWithCookies([
      { name: "accessToken", value: "fresh-access", expires: future },
    ]);

    expect(hasFreshAuthCookies(persona)).toBe(true);
  });

  test("does not trust a future refresh token when the primary access token is expired", () => {
    const expired = Math.floor(Date.now() / 1000) - 60;
    const future = Math.floor(Date.now() / 1000) + 3600;
    const persona = personaWithCookies([
      { name: "accessToken", value: "expired-access", expires: expired },
      { name: "refreshToken", value: "fresh-refresh", expires: future },
    ]);

    expect(hasFreshAuthCookies(persona)).toBe(false);
  });

  test("uses the updatedAt fallback only for session cookies without explicit expiry", () => {
    const persona = personaWithCookies([
      { name: "session", value: "browser-session" },
    ]);

    expect(hasFreshAuthCookies(persona)).toBe(true);
  });
});
