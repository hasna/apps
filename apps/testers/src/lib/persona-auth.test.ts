import { describe, expect, test } from "bun:test";
import { isSessionCookie } from "./persona-auth.js";

describe("persona auth cookie classification", () => {
  test("does not treat CSRF cookies as authenticated sessions", () => {
    expect(isSessionCookie("csrfToken")).toBe(false);
    expect(isSessionCookie("XSRF-TOKEN")).toBe(false);
  });

  test("treats ordinary app cookies as session evidence", () => {
    expect(isSessionCookie("accessToken")).toBe(true);
    expect(isSessionCookie("refreshToken")).toBe(true);
  });
});
