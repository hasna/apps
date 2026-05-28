import { describe, test, expect } from "bun:test";
import type { SavedAuthState } from "./recorder.js";
import { authStateToScenarioMetadata, actionsToScenarioInput, type RecordingResult } from "./recorder.js";

describe("recorder", () => {
  describe("actionsToScenarioInput", () => {
    test("converts navigation to step", () => {
      const recording: RecordingResult = {
        url: "http://example.com",
        actions: [{ type: "navigate", url: "http://example.com", timestamp: 0 }],
        duration: 1000,
      };
      const input = actionsToScenarioInput(recording, "Test Scenario");
      expect(input.steps).toContain('Navigate to http://example.com');
    });

    test("converts click actions to steps", () => {
      const recording: RecordingResult = {
        url: "http://example.com",
        actions: [{ type: "click", selector: "#submit", timestamp: 100 }],
        duration: 1000,
      };
      const input = actionsToScenarioInput(recording, "Click Test");
      expect(input.steps).toContain('Click #submit');
    });

    test("deduplicates fill actions", () => {
      const recording: RecordingResult = {
        url: "http://example.com",
        actions: [
          { type: "fill", selector: "#email", value: "a@b.com", timestamp: 100 },
          { type: "fill", selector: "#email", value: "final@b.com", timestamp: 200 },
        ],
        duration: 1000,
      };
      const input = actionsToScenarioInput(recording, "Fill Test");
      expect(input.steps).toContain('Fill #email with "final@b.com"');
    });
  });

  describe("authStateToScenarioMetadata", () => {
    test("creates scenario with auth metadata", () => {
      const authState: SavedAuthState = {
        cookies: [{ name: "session", value: "abc123", domain: "example.com", path: "/" }],
        localStorage: [],
        loginUrl: "http://example.com/login",
        recordedAt: "2026-01-01T00:00:00Z",
      };
      const scenario = authStateToScenarioMetadata(authState, "Auth Scenario");
      expect(scenario.name).toBe("Auth Scenario");
      expect(scenario.requiresAuth).toBe(true);
      expect(scenario.tags).toContain("auth");
      expect(scenario.metadata).toBeDefined();
    });

    test("stores auth state in metadata", () => {
      const authState: SavedAuthState = {
        cookies: [{ name: "token", value: "xyz", domain: "test.com", path: "/app" }],
        localStorage: [{ origin: "http://test.com", entries: [{ name: "user", value: "1" }] }],
        loginUrl: "http://test.com/login",
        recordedAt: "2026-01-01T00:00:00Z",
      };
      const scenario = authStateToScenarioMetadata(authState, "Full Auth");
      const meta = scenario.metadata as { authState?: SavedAuthState } | null;
      expect(meta?.authState).toBeDefined();
      expect(meta?.authState?.cookies).toHaveLength(1);
      expect(meta?.authState?.cookies[0].name).toBe("token");
    });
  });
});
