import { describe, test, expect } from "bun:test";
import { generateApiScenarios, groupEndpoints, summarizeEndpoints } from "./api-discovery.js";
import type { DiscoveredEndpoint } from "./api-discovery.js";

describe("API auto-discovery (OPE9-00228)", () => {
  const sampleEndpoints: DiscoveredEndpoint[] = [
    { url: "http://example.com/api/users", method: "GET", status: 200, resourceType: "xhr", responseSize: 1024, responseTime: 150, hasAuth: true },
    { url: "http://example.com/api/users/abc123", method: "GET", status: 200, resourceType: "fetch", responseSize: 512, responseTime: 80, hasAuth: true },
    { url: "http://example.com/api/users", method: "POST", status: 201, resourceType: "xhr", responseSize: 256, responseTime: 200, hasAuth: true },
    { url: "http://example.com/api/products", method: "GET", status: 500, resourceType: "xhr", responseSize: 64, responseTime: 5000, hasAuth: false },
  ];

  describe("generateApiScenarios", () => {
    test("generates scenarios from endpoints", () => {
      const scenarios = generateApiScenarios(sampleEndpoints);
      expect(scenarios).toHaveLength(4);
      expect(scenarios[0].name).toContain("GET");
      expect(scenarios[0].type).toBe("api");
      expect(scenarios[0].tags).toContain("api");
      expect(scenarios[0].tags).toContain("auto-discovered");
    });

    test("marks 500 status as critical priority", () => {
      const scenarios = generateApiScenarios(sampleEndpoints);
      const productScenario = scenarios.find((s) => s.name.includes("products"));
      expect(productScenario?.priority).toBe("critical");
    });

    test("includes description with response details", () => {
      const scenarios = generateApiScenarios(sampleEndpoints);
      expect(scenarios[0].description).toContain("status: 200");
    });
  });

  describe("groupEndpoints", () => {
    test("groups endpoints by first path segment", () => {
      const groups = groupEndpoints(sampleEndpoints);
      expect(groups["api"]).toHaveLength(4);
    });

    test("handles root-level paths", () => {
      const eps: DiscoveredEndpoint[] = [{
        url: "http://example.com/",
        method: "GET",
        status: 200,
        resourceType: "xhr",
        responseSize: 100,
        responseTime: 50,
        hasAuth: false,
      }];
      const groups = groupEndpoints(eps);
      expect(groups["root"]).toBeDefined();
    });
  });

  describe("summarizeEndpoints", () => {
    test("returns summary with counts and stats", () => {
      const summary = summarizeEndpoints(sampleEndpoints);
      expect(summary).toContain("4 API endpoints");
      expect(summary).toContain("GET: 3");
      expect(summary).toContain("POST: 1");
      expect(summary).toContain("Auth-protected: 3");
      expect(summary).toContain("Error endpoints: 1");
    });

    test("handles empty endpoints", () => {
      const summary = summarizeEndpoints([]);
      expect(summary).toContain("0 API endpoints");
    });
  });
});
