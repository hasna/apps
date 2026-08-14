import { describe, test, expect } from "bun:test";
import { detectEnvironment, getEnvironmentOverride, getEnvInfo } from "./environment.js";

describe("environment auto-detection (OPE9-00227)", () => {
  describe("detectEnvironment", () => {
    test("detects localhost as development", () => {
      const info = detectEnvironment("http://localhost:3000");
      expect(info.env).toBe("development");
      expect(info.host).toBe("localhost:3000");
      expect(info.protocol).toBe("http");
    });

    test("detects dev. subdomain as development", () => {
      const info = detectEnvironment("https://dev.example.com");
      expect(info.env).toBe("development");
    });

    test("detects dev- prefix as development", () => {
      const info = detectEnvironment("https://dev-api.example.com");
      expect(info.env).toBe("development");
    });

    test("detects staging subdomain as staging", () => {
      const info = detectEnvironment("https://staging.example.com");
      expect(info.env).toBe("staging");
    });

    test("detects preview deploy as staging", () => {
      const info = detectEnvironment("https://pr-123--myapp.vercel.app");
      expect(info.env).toBe("staging");
    });

    test("detects uat. subdomain as staging", () => {
      const info = detectEnvironment("https://uat.example.com");
      expect(info.env).toBe("staging");
    });

    test("detects production domain as production", () => {
      const info = detectEnvironment("https://example.com");
      expect(info.env).toBe("production");
      expect(info.domain).toBe("example.com");
    });

    test("handles invalid URLs", () => {
      const info = detectEnvironment("not-a-url");
      expect(info.env).toBe("unknown");
      expect(info.host).toBe("not-a-url");
    });
  });

  describe("getEnvironmentOverride", () => {
    test("returns null when not set", () => {
      const orig = process.env.TESTERS_ENV;
      delete process.env.TESTERS_ENV;
      expect(getEnvironmentOverride()).toBeNull();
      process.env.TESTERS_ENV = orig;
    });

    test("recognizes prod override", () => {
      process.env.TESTERS_ENV = "prod";
      expect(getEnvironmentOverride()).toBe("production");
      delete process.env.TESTERS_ENV;
    });

    test("recognizes staging override", () => {
      process.env.TESTERS_ENV = "staging";
      expect(getEnvironmentOverride()).toBe("staging");
      delete process.env.TESTERS_ENV;
    });

    test("recognizes dev override", () => {
      process.env.TESTERS_ENV = "dev";
      expect(getEnvironmentOverride()).toBe("development");
      delete process.env.TESTERS_ENV;
    });
  });

  describe("getEnvInfo", () => {
    test("returns detected env without override", () => {
      const info = getEnvInfo("http://localhost:3000");
      expect(info.env).toBe("development");
      expect(info.label).toBe("Development");
    });

    test("override takes precedence", () => {
      process.env.TESTERS_ENV = "production";
      const info = getEnvInfo("http://localhost:3000");
      expect(info.env).toBe("production");
      expect(info.label).toBe("Production");
      delete process.env.TESTERS_ENV;
    });
  });
});
