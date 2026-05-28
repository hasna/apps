import { describe, test, expect } from "bun:test";
import type { Page } from "playwright";
import type { MockRule } from "./network-mock.js";
import { MockPresets } from "./network-mock.js";

describe("network-mock", () => {
  describe("MockPresets", () => {
    test("emptyApi returns a single wildcard rule", () => {
      const rules = MockPresets.emptyApi();
      expect(rules).toHaveLength(1);
      expect(rules[0].url).toBe("/api/**");
      expect(rules[0].status).toBe(200);
      expect(rules[0].body).toEqual({});
    });

    test("serverError creates 500 mock for specific path", () => {
      const rules = MockPresets.serverError("/api/users");
      expect(rules).toHaveLength(1);
      expect(rules[0].url).toBe("/api/users");
      expect(rules[0].status).toBe(500);
    });

    test("timeout creates abort rule", () => {
      const rules = MockPresets.timeout("/api/slow");
      expect(rules).toHaveLength(1);
      expect(rules[0].abort).toBe("timedout");
    });

    test("blockTrackers uses regex pattern", () => {
      const rules = MockPresets.blockTrackers();
      expect(rules).toHaveLength(1);
      expect(rules[0].url).toBeInstanceOf(RegExp);
      expect(rules[0].abort).toBe(true);
    });

    test("mockAuth creates auth endpoint mock", () => {
      const rules = MockPresets.mockAuth("custom-token");
      expect(rules).toHaveLength(1);
      expect(rules[0].url).toBe("**/auth/**");
      expect(rules[0].body).toEqual({ token: "custom-token", expires_in: 3600 });
    });
  });

  describe("MockRule type", () => {
    test("rule with all fields is valid", () => {
      const rule: MockRule = {
        url: "/api/test",
        method: "GET",
        status: 201,
        headers: { "X-Custom": "value" },
        body: { created: true },
        delay: 100,
      };
      expect(rule.url).toBe("/api/test");
      expect(rule.method).toBe("GET");
      expect(rule.status).toBe(201);
      expect(rule.headers).toEqual({ "X-Custom": "value" });
      expect(rule.delay).toBe(100);
    });

    test("rule with regex pattern works", () => {
      const rule: MockRule = {
        url: /analytics/i,
        abort: true,
      };
      expect(rule.url).toBeInstanceOf(RegExp);
      expect(rule.abort).toBe(true);
    });

    test("abort as string works", () => {
      const rule: MockRule = {
        url: "/api/slow",
        abort: "timedout",
      };
      expect(rule.abort).toBe("timedout");
    });
  });
});
