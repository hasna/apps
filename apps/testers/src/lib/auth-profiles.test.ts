import { describe, test, expect } from "bun:test";
import { serializeProfile, deserializeProfile } from "./auth-profiles.js";

describe("auth profiles (OPE9-00243)", () => {
  describe("serializeProfile", () => {
    test("serializes form-login profile", () => {
      const p = {
        strategy: "form-login" as const,
        email: "user@test.com",
        password: "secret",
        loginPath: "/sign-in",
        emailFieldSelector: '#email',
        passwordFieldSelector: '#pass',
        submitSelector: '#login-btn',
        postLoginWaitFor: ".dashboard",
      };

      const serialized = serializeProfile(p);
      expect(serialized.strategy).toBe("form-login");
      expect(serialized.email).toBe("user@test.com");
      expect(serialized.password).toBe("secret");
      expect(serialized.login_path).toBe("/sign-in");
      expect(serialized.email_field_selector).toBe("#email");
      expect(serialized.bearer_token).toBeNull();
      expect(serialized.custom_script).toBeNull();
    });

    test("serializes bearer profile", () => {
      const p = {
        strategy: "bearer" as const,
        bearerToken: "eyJhbGciOiJIUzI1NiJ9.token",
        headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.token" },
      };

      const serialized = serializeProfile(p);
      expect(serialized.strategy).toBe("bearer");
      expect(serialized.bearer_token).toBe("eyJhbGciOiJIUzI1NiJ9.token");
      expect(serialized.headers).toContain("Authorization");
    });

    test("serializes cookie profile", () => {
      const p = {
        strategy: "cookie" as const,
        cookies: [{ name: "session", value: "abc123", domain: "example.com", path: "/" }],
      };

      const serialized = serializeProfile(p);
      expect(serialized.strategy).toBe("cookie");
      expect(serialized.cookies).toContain("session");
      expect(serialized.cookies).toContain("abc123");
    });

    test("serializes custom_script profile", () => {
      const p = {
        strategy: "custom_script" as const,
        customScript: 'await page.goto("/login"); await page.fill("#u", profile.email);',
      };

      const serialized = serializeProfile(p);
      expect(serialized.strategy).toBe("custom_script");
      expect(serialized.custom_script).toContain("page.goto");
    });
  });

  describe("deserializeProfile", () => {
    test("deserializes form-login profile", () => {
      const row = {
        strategy: "form-login",
        email: "admin@test.com",
        password: "admin123",
        login_path: "/admin/login",
        email_field_selector: null,
        password_field_selector: null,
        submit_selector: null,
        post_login_wait_for: ".admin-panel",
        bearer_token: null,
        cookies: null,
        oauth_provider: null,
        custom_script: null,
        headers: null,
      };

      const p = deserializeProfile(row);
      expect(p.strategy).toBe("form-login");
      expect(p.email).toBe("admin@test.com");
      expect(p.loginPath).toBe("/admin/login");
      expect(p.postLoginWaitFor).toBe(".admin-panel");
      expect(p.cookies).toBeUndefined();
    });

    test("deserializes oauth profile", () => {
      const row = {
        strategy: "oauth",
        email: "user@gmail.com",
        password: "google_pass",
        login_path: null,
        email_field_selector: null,
        password_field_selector: null,
        submit_selector: null,
        post_login_wait_for: null,
        bearer_token: null,
        cookies: null,
        oauth_provider: "google",
        custom_script: null,
        headers: null,
      };

      const p = deserializeProfile(row);
      expect(p.strategy).toBe("oauth");
      expect(p.oauthProvider).toBe("google");
    });

    test("defaults to form-login strategy", () => {
      const p = deserializeProfile({ strategy: null, email: null, password: null, login_path: null, email_field_selector: null, password_field_selector: null, submit_selector: null, post_login_wait_for: null, bearer_token: null, cookies: null, oauth_provider: null, custom_script: null, headers: null });
      expect(p.strategy).toBe("form-login");
    });

    test("round-trips bearer profile", () => {
      const original = {
        strategy: "bearer" as const,
        bearerToken: "my-token-123",
        headers: { Authorization: "Bearer my-token-123" },
      };

      const serialized = serializeProfile(original);
      const deserialized = deserializeProfile(serialized);
      expect(deserialized.strategy).toBe("bearer");
      expect(deserialized.bearerToken).toBe("my-token-123");
      expect(deserialized.headers).toEqual({ Authorization: "Bearer my-token-123" });
    });
  });
});
