import { describe, test, expect } from "bun:test";
import { TEST_ENDPOINTS } from "./test-endpoints.js";

describe("TEST_ENDPOINTS", () => {
  test("defines health-check endpoints for major connectors", () => {
    expect(Object.keys(TEST_ENDPOINTS).length).toBeGreaterThan(30);
    expect(TEST_ENDPOINTS.stripe).toBeDefined();
    expect(TEST_ENDPOINTS.github).toBeDefined();
    expect(TEST_ENDPOINTS.gmail).toBeDefined();
    expect(TEST_ENDPOINTS.anthropic).toBeDefined();
  });

  test("each endpoint has a valid URL and headers factory", () => {
    for (const [name, endpoint] of Object.entries(TEST_ENDPOINTS)) {
      expect(endpoint.url.startsWith("http")).toBe(true);
      expect(typeof endpoint.headers).toBe("function");

      const headers = endpoint.headers("test-key");
      expect(typeof headers).toBe("object");

      if (endpoint.method) {
        expect(["GET", "POST", "PUT", "PATCH", "DELETE"]).toContain(endpoint.method);
      }

      if (endpoint.successCodes) {
        expect(endpoint.successCodes.length).toBeGreaterThan(0);
        for (const code of endpoint.successCodes) {
          expect(code).toBeGreaterThanOrEqual(200);
          expect(code).toBeLessThan(600);
        }
      }

      // Sanity check a few auth header shapes
      if (name === "stripe") {
        expect(headers.Authorization).toBe("Bearer test-key");
      }
      if (name === "anthropic") {
        expect(headers["x-api-key"]).toBe("test-key");
      }
    }
  });

  test("includes OAuth Google workspace connectors", () => {
    for (const name of [
      "gmail",
      "googledrive",
      "googlecalendar",
      "googletasks",
      "googlecontacts",
    ]) {
      expect(TEST_ENDPOINTS[name]).toBeDefined();
      expect(TEST_ENDPOINTS[name].headers("oauth-token").Authorization).toBe(
        "Bearer oauth-token"
      );
    }
  });

  test("includes a stable User-Agent for Tumblr health checks", () => {
    expect(TEST_ENDPOINTS.tumblr).toBeDefined();
    expect(TEST_ENDPOINTS.tumblr.headers("oauth-token")).toMatchObject({
      Authorization: "Bearer oauth-token",
      "User-Agent": "@hasna/connect-tumblr/0.1",
    });
  });

  test("POST endpoints include a JSON body", () => {
    const postEndpoints = Object.entries(TEST_ENDPOINTS).filter(
      ([, endpoint]) => endpoint.method === "POST"
    );
    expect(postEndpoints.length).toBeGreaterThan(0);
    for (const [, endpoint] of postEndpoints) {
      expect(endpoint.body).toBeDefined();
    }
  });
});
