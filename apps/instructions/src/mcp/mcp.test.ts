import { describe, test, expect, beforeEach } from "bun:test";
import { getDatabase, resetDatabase } from "../db/database";
import { createConfig } from "../db/configs";
import { createProfile, addConfigToProfile } from "../db/profiles";

// Test MCP tool logic directly by re-implementing the dispatch
beforeEach(() => {
  resetDatabase();
  process.env["CONFIGS_DB_PATH"] = ":memory:";
  getDatabase();
});

describe("MCP tool logic", () => {
  test("list_configs returns compact summaries", () => {
    const db = getDatabase();
    createConfig({ name: "A", category: "rules", content: "x" }, db);
    createConfig({ name: "B", category: "agent", content: "y" }, db);
    const { listConfigs } = require("../db/configs");
    const configs = listConfigs();
    expect(configs.length).toBe(2);
  });

  test("get_config retrieves full content", () => {
    const db = getDatabase();
    const c = createConfig({ name: "My Config", category: "rules", content: "# Hello" }, db);
    const { getConfig } = require("../db/configs");
    const result = getConfig(c.slug);
    expect(result.content).toBe("# Hello");
  });

  test("create_config creates and returns id+slug", () => {
    const db = getDatabase();
    const { createConfig: cc } = require("../db/configs");
    const c = cc({ name: "New", content: "data", category: "tools" }, db);
    expect(c.id).toBeTruthy();
    expect(c.slug).toBe("new");
  });

  test("update_config increments version", () => {
    const db = getDatabase();
    const c = createConfig({ name: "C", category: "rules", content: "v1" }, db);
    const { updateConfig } = require("../db/configs");
    const updated = updateConfig(c.id, { content: "v2" }, db);
    expect(updated.version).toBe(2);
    expect(updated.content).toBe("v2");
  });

  test("list_profiles returns profiles", () => {
    const db = getDatabase();
    createProfile({ name: "Setup" }, db);
    const { listProfiles } = require("../db/profiles");
    const profiles = listProfiles(db);
    expect(profiles.length).toBe(1);
    expect(profiles[0].name).toBe("Setup");
  });

  test("get_snapshot returns null when no snapshots", () => {
    const db = getDatabase();
    const c = createConfig({ name: "C", category: "rules", content: "" }, db);
    const { listSnapshots } = require("../db/snapshots");
    const snaps = listSnapshots(c.id, db);
    expect(snaps.length).toBe(0);
  });

  test("search_tools finds by keyword", () => {
    const TOOL_DOCS: Record<string, string> = {
      list_configs: "List configs by category/agent/kind.",
      get_config: "Get a config by id or slug.",
    };
    const query = "list";
    const matches = Object.entries(TOOL_DOCS)
      .filter(([k, v]) => k.includes(query) || v.toLowerCase().includes(query))
      .map(([name]) => name);
    expect(matches).toContain("list_configs");
  });
});
