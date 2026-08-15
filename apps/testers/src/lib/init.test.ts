process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { detectFramework, getStarterScenarios } from "./init.js";

describe("init", () => {
  const testDir = join(tmpdir(), `open-testers-init-test-${Date.now()}`);

  beforeEach(() => {
    resetDatabase();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    closeDatabase();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("detectFramework", () => {
    test("returns null for empty dir (no package.json)", () => {
      const result = detectFramework(testDir);
      expect(result).toBeNull();
    });

    test("detects Next.js framework", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { next: "14.0.0", react: "18.0.0" } }),
      );

      const result = detectFramework(testDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Next.js");
      expect(result!.defaultUrl).toBe("http://localhost:3000");
    });

    test("detects Vite framework", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ devDependencies: { vite: "5.0.0" } }),
      );

      const result = detectFramework(testDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Vite");
      expect(result!.defaultUrl).toBe("http://localhost:5173");
    });

    test("detects auth feature from next-auth", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { next: "14.0.0", "next-auth": "5.0.0" } }),
      );

      const result = detectFramework(testDir);
      expect(result).not.toBeNull();
      expect(result!.features).toContain("hasAuth");
    });

    test("detects forms feature from react-hook-form", () => {
      writeFileSync(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { next: "14.0.0", "react-hook-form": "7.0.0" } }),
      );

      const result = detectFramework(testDir);
      expect(result).not.toBeNull();
      expect(result!.features).toContain("hasForms");
    });

    test("returns null for invalid package.json", () => {
      writeFileSync(join(testDir, "package.json"), "not valid json");

      const result = detectFramework(testDir);
      expect(result).toBeNull();
    });
  });

  describe("getStarterScenarios", () => {
    test("returns base scenarios for generic/unknown framework", () => {
      const scenarios = getStarterScenarios(
        { name: "Unknown", features: [] },
        "project-123",
      );

      expect(scenarios.length).toBe(3);
      const names = scenarios.map((s) => s.name);
      expect(names).toContain("Homepage loads");
      expect(names).toContain("Form submit works");
      expect(names).toContain("Mobile viewport check");
    });

    test("all base scenarios have the correct projectId", () => {
      const scenarios = getStarterScenarios(
        { name: "Unknown", features: [] },
        "my-project-id",
      );

      for (const s of scenarios) {
        expect(s.projectId).toBe("my-project-id");
      }
    });

    test("returns Next.js-specific scenarios", () => {
      const scenarios = getStarterScenarios(
        { name: "Next.js", features: [] },
        "project-123",
      );

      expect(scenarios.length).toBe(3); // Homepage, 404, Navigation
      const names = scenarios.map((s) => s.name);
      expect(names).toContain("Homepage loads");
      expect(names).toContain("404 page works");
      expect(names).toContain("Navigation links work");
    });

    test("adds auth scenarios for Next.js when hasAuth feature present", () => {
      const scenarios = getStarterScenarios(
        { name: "Next.js", features: ["hasAuth"] },
        "project-123",
      );

      expect(scenarios.length).toBe(5); // 3 base + 2 auth
      const names = scenarios.map((s) => s.name);
      expect(names).toContain("Login flow");
      expect(names).toContain("Protected route redirect");
    });

    test("adds forms scenario for Next.js when hasForms feature present", () => {
      const scenarios = getStarterScenarios(
        { name: "Next.js", features: ["hasForms"] },
        "project-123",
      );

      expect(scenarios.length).toBe(4); // 3 base + 1 forms
      const names = scenarios.map((s) => s.name);
      expect(names).toContain("Form validation");
    });

    test("adds both auth and forms scenarios for Next.js when both features present", () => {
      const scenarios = getStarterScenarios(
        { name: "Next.js", features: ["hasAuth", "hasForms"] },
        "project-123",
      );

      expect(scenarios.length).toBe(6); // 3 base + 2 auth + 1 forms
    });

    test("adds auth scenarios for generic framework when hasAuth feature present", () => {
      const scenarios = getStarterScenarios(
        { name: "Unknown", features: ["hasAuth"] },
        "project-123",
      );

      const names = scenarios.map((s) => s.name);
      expect(names).toContain("Login flow");
    });
  });
});
