import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, existsSync, rmdirSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  injectIntoAgentMd,
  injectIntoAllAgentMds,
  injectIntoClaudeMd,
  removeFromAgentMd,
  removeFromAllAgentMds,
  removeFromClaudeMd,
} from "../lib/contextinjector.js";
import { mkdirSync as mkdir } from "fs";

let testProjectPath = "";

function rmRecursive(dir: string) {
  if (!existsSync(dir)) return;
  for (const entry of require("fs").readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      rmRecursive(p);
    } else {
      require("fs").unlinkSync(p);
    }
  }
  require("fs").rmdirSync(dir);
}

beforeEach(() => {
  testProjectPath = join(tmpdir(), `styles-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testProjectPath, { recursive: true });
});

afterEach(() => {
  if (existsSync(testProjectPath)) {
    rmRecursive(testProjectPath);
  }
});

import type { StyleProfile } from "../lib/profiles.js";
import type { StyleMeta } from "../lib/registry.js";

const FIXTURE_PROFILE: StyleProfile = {
  id: "test-1",
  name: "custom-style",
  displayName: "Custom Style",
  description: "Custom design system",
  category: "custom",
  principles: ["Keep it simple"],
  antiPatterns: ["Don't nest cards"],
  typography: {},
  colors: {},
  componentRules: {},
  tags: ["custom"],
  createdAt: 0,
  builtin: false,
};

describe("injectIntoAgentMd", () => {
  test("creates CLAUDE.md when it doesn't exist", () => {
    const result = injectIntoAgentMd(testProjectPath, "claude", FIXTURE_PROFILE, {});
    expect(result.action).toBe("created");
    expect(existsSync(join(testProjectPath, "CLAUDE.md"))).toBe(true);
  });

  test("updates existing CLAUDE.md", () => {
    writeFileSync(join(testProjectPath, "CLAUDE.md"), "# Existing content\n", "utf-8");
    const result = injectIntoAgentMd(testProjectPath, "claude", FIXTURE_PROFILE, {});
    expect(result.action).toBe("updated");
  });

  test("creates GEMINI.md for gemini agent", () => {
    const result = injectIntoAgentMd(testProjectPath, "gemini", FIXTURE_PROFILE, {});
    expect(result.action).toBe("created");
    expect(existsSync(join(testProjectPath, "GEMINI.md"))).toBe(true);
  });

  test("creates AGENTS.md for codex agent", () => {
    const result = injectIntoAgentMd(testProjectPath, "codex", FIXTURE_PROFILE, {});
    expect(result.action).toBe("created");
    expect(existsSync(join(testProjectPath, "AGENTS.md"))).toBe(true);
  });

  test("creates PI.md for pi agent", () => {
    const result = injectIntoAgentMd(testProjectPath, "pi", FIXTURE_PROFILE, {});
    expect(result.action).toBe("created");
    expect(existsSync(join(testProjectPath, "PI.md"))).toBe(true);
  });
});

describe("injectIntoAllAgentMds", () => {
  test("returns null for undetected agents", () => {
    const results = injectIntoAllAgentMds(testProjectPath, FIXTURE_PROFILE, {});
    for (const [, val] of Object.entries(results)) {
      expect(val).toBeNull();
    }
  });

  test("injects into detected agents only", () => {
    mkdirSync(join(testProjectPath, ".claude"));
    const results = injectIntoAllAgentMds(testProjectPath, FIXTURE_PROFILE, {});
    expect(results.claude).not.toBeNull();
    expect(results.gemini).toBeNull();
    if (results.claude) expect(results.claude.action).toBe("created");
  });
});

describe("injectIntoClaudeMd (legacy)", () => {
  test("creates CLAUDE.md when none exists", () => {
    const result = injectIntoClaudeMd(testProjectPath, FIXTURE_PROFILE, {});
    expect(result.action).toBe("created");
  });

  test("updates CLAUDE.md when section exists", () => {
    writeFileSync(join(testProjectPath, "CLAUDE.md"), "<!-- open-styles-start -->\nold\n<!-- open-styles-end -->\n", "utf-8");
    const result = injectIntoClaudeMd(testProjectPath, FIXTURE_PROFILE, { theme: "light" });
    expect(result.action).toBe("updated");
  });

  test("returns unchanged when content is identical", () => {
    // First inject to get the marker in
    injectIntoClaudeMd(testProjectPath, FIXTURE_PROFILE, {});
    // Second inject with same content
    const result = injectIntoClaudeMd(testProjectPath, FIXTURE_PROFILE, {});
    expect(result.action).toBe("unchanged");
  });
});

describe("removeFromAgentMd", () => {
  test("removes section from file", () => {
    injectIntoAgentMd(testProjectPath, "claude", FIXTURE_PROFILE, {});
    const content = readFileSync(join(testProjectPath, "CLAUDE.md"), "utf-8");
    expect(content).toContain("open-styles-start");

    const result = removeFromAgentMd(testProjectPath, "claude");
    expect(result.action).toBe("removed");
    const after = readFileSync(join(testProjectPath, "CLAUDE.md"), "utf-8");
    expect(after).not.toContain("open-styles-start");
  });

  test("returns not-found for non-existent file", () => {
    const result = removeFromAgentMd(testProjectPath, "claude");
    expect(result.action).toBe("not-found");
  });

  test("returns not-found when no marker present", () => {
    writeFileSync(join(testProjectPath, "CLAUDE.md"), "just some text", "utf-8");
    const result = removeFromAgentMd(testProjectPath, "claude");
    expect(result.action).toBe("not-found");
  });
});

describe("removeFromAllAgentMds", () => {
  test("does not throw when no files exist", () => {
    expect(() => removeFromAllAgentMds(testProjectPath)).not.toThrow();
  });
});

describe("removeFromClaudeMd (legacy)", () => {
  test("delegates to removeFromAgentMd", () => {
    const result = removeFromClaudeMd(testProjectPath);
    expect(result.action).toBe("not-found");
  });
});
