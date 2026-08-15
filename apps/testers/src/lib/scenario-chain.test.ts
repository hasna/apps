import { describe, test, expect } from "bun:test";
import { extractChainOutput, applyChainOutput, resolveChain, hasChainDependency } from "./scenario-chain.js";
import type { Result, Scenario } from "../types/index.js";

describe("scenario chaining (OPE9-00268)", () => {
  describe("extractChainOutput", () => {
    test("extracts key-value pairs from reasoning", () => {
      const result = {
        scenarioId: "s1",
        status: "passed" as const,
        reasoning: "Navigated to user page and found user ID: 42. Extracted name: John Doe",
        durationMs: 1000,
        tokensUsed: 100,
        costCents: 1,
        stepsCompleted: 3,
        stepsTotal: 3,
        model: "quick",
      } as Result;

      const output = extractChainOutput(result, "Find User");
      expect(output.scenarioName).toBe("Find User");
      expect(output.passed).toBe(true);
      expect(output.data["user_id"]).toBe("42");
      expect(output.data["name"]).toBe("John Doe");
    });

    test("returns empty data when no extractable patterns", () => {
      const result = {
        scenarioId: "s1",
        status: "passed" as const,
        reasoning: "Page loaded successfully",
        durationMs: 1000,
        tokensUsed: 100,
        costCents: 1,
        stepsCompleted: 1,
        stepsTotal: 1,
        model: "quick",
      } as Result;

      const output = extractChainOutput(result, "Load Page");
      expect(output.data).toEqual({});
      expect(output.passed).toBe(true);
    });

    test("marks failed scenarios as not passed", () => {
      const result = {
        scenarioId: "s1",
        status: "failed" as const,
        reasoning: "found id: 123",
        durationMs: 1000,
        tokensUsed: 100,
        costCents: 1,
        stepsCompleted: 0,
        stepsTotal: 1,
        model: "quick",
      } as Result;

      const output = extractChainOutput(result, "Fail Test");
      expect(output.passed).toBe(false);
    });
  });

  describe("applyChainOutput", () => {
    test("replaces placeholders in steps", () => {
      const scenario = {
        id: "s2",
        steps: ["Navigate to /user/{{user_id}}", "Verify {{name}} is displayed"],
        description: "View user {{user_id}} profile",
        parameters: {},
        name: "View User",
        tags: [],
        priority: "medium" as const,
        requiresAuth: false,
        model: "quick",
        timeoutMs: 30000,
      } as unknown as Scenario;

      const result = applyChainOutput(scenario, { user_id: "42", name: "John" });
      expect(result.steps[0]).toBe("Navigate to /user/42");
      expect(result.steps[1]).toBe("Verify John is displayed");
      expect(result.description).toContain("42");
      expect(result.parameters["user_id"]).toBe("42");
    });

    test("returns unchanged scenario when no chain data", () => {
      const scenario = {
        id: "s2",
        steps: ["Click login"],
        description: "Login test",
        parameters: {},
        name: "Login",
        tags: [],
        priority: "medium" as const,
        requiresAuth: false,
        model: "quick",
        timeoutMs: 30000,
      } as unknown as Scenario;

      const result = applyChainOutput(scenario, {});
      expect(result).toBe(scenario);
    });
  });

  describe("hasChainDependency", () => {
    test("detects placeholder in steps", () => {
      const scenario = { steps: ["Navigate to /user/{{userId}}"] } as unknown as Scenario;
      expect(hasChainDependency(scenario)).toBe(true);
    });

    test("returns false for steps without placeholders", () => {
      const scenario = { steps: ["Click login", "Enter email"] } as unknown as Scenario;
      expect(hasChainDependency(scenario)).toBe(false);
    });
  });

  describe("resolveChain", () => {
    test("resolves chain from source to target", () => {
      const scenarios: Scenario[] = [
        { id: "s1", name: "Find User", steps: ["Search for user"], tags: [], priority: "medium" as const, requiresAuth: false, model: "quick", timeoutMs: 30000, description: "" },
        { id: "s2", name: "View User", steps: ["Go to /user/{{user_id}}"], tags: [], priority: "medium" as const, requiresAuth: false, model: "quick", timeoutMs: 30000, description: "" },
      ] as unknown as Scenario[];

      const results: Result[] = [
        { scenarioId: "s1", status: "passed", reasoning: "found user_id: abc123", durationMs: 1000, tokensUsed: 100, costCents: 1, stepsCompleted: 1, stepsTotal: 1, model: "quick" },
      ] as Result[];

      const links = [{ sourceId: "s1", targetId: "s2", mapping: { user_id: "user_id" } }];

      const resolved = resolveChain(scenarios, results, links);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].scenario.steps[0]).toBe("Go to /user/abc123");
    });

    test("skips chain when source failed", () => {
      const scenarios: Scenario[] = [
        { id: "s1", name: "Find User", steps: [], tags: [], priority: "medium" as const, requiresAuth: false, model: "quick", timeoutMs: 30000, description: "" },
        { id: "s2", name: "View User", steps: ["Go to /user/{{user_id}}"], tags: [], priority: "medium" as const, requiresAuth: false, model: "quick", timeoutMs: 30000, description: "" },
      ] as unknown as Scenario[];

      const results: Result[] = [
        { scenarioId: "s1", status: "failed", reasoning: "not found", durationMs: 1000, tokensUsed: 100, costCents: 1, stepsCompleted: 0, stepsTotal: 1, model: "quick" },
      ] as Result[];

      const links = [{ sourceId: "s1", targetId: "s2", mapping: { user_id: "user_id" } }];
      const resolved = resolveChain(scenarios, results, links);
      expect(resolved).toHaveLength(0);
    });
  });
});
