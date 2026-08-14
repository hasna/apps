import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createConfig } from "./configs.js";
import { getDatabase, resetDatabase } from "./database.js";
import {
  addConfigToProfile,
  createProfile,
  getProfileConfigBindings,
  setProfileConfigBinding,
} from "./profiles.js";
import { PROFILE_CONFIG_BINDING_SCHEMA } from "../types/index.js";

let db: Database;

beforeEach(() => {
  resetDatabase();
  db = getDatabase(":memory:");
});

describe("persisted profile config bindings", () => {
  test("legacy membership rows reload as always-on bindings", () => {
    const profile = createProfile({ name: "Legacy" }, db);
    const config = createConfig({ name: "Rule", category: "rules", content: "# Rule" }, db);
    addConfigToProfile(profile.id, config.id, db);
    expect(getProfileConfigBindings(profile.id, db)).toEqual([expect.objectContaining({
      profile_id: profile.id,
      config_id: config.id,
      binding: expect.objectContaining({ activation: { mode: "always" }, required: true, fallback: "fail" }),
    })]);
  });

  test("binding metadata persists and reloads independently from config content", () => {
    const profile = createProfile({ name: "Scoped" }, db);
    const config = createConfig({ name: "Rule", category: "rules", content: "canonical bytes" }, db);
    addConfigToProfile(profile.id, config.id, db);
    const stored = setProfileConfigBinding(profile.id, config.id, {
      schema: PROFILE_CONFIG_BINDING_SCHEMA,
      activation: { mode: "glob", globs: ["src/**/*.ts"], description: "TS only", directory_scope: "src" },
      required: false,
      fallback: "omit",
      providers: [{ provider: "cursor", version_range: ">=1.0.0" }],
      depends_on: [],
      replaces: ["old-rule"],
      conflicts_with: ["other-rule"],
    }, db);
    const reloaded = getProfileConfigBindings(profile.id, db)[0]!;
    expect(reloaded).toEqual(stored);
    expect(reloaded.binding.activation.globs).toEqual(["src/**/*.ts"]);
    expect(reloaded.binding.providers?.[0]?.version_range).toBe(">=1.0.0");
    expect(createConfig).toBeDefined();
  });
});
