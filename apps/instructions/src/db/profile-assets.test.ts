import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { configAssetDigest, configAssetLocator } from "../lib/asset-plan.js";
import { PROFILE_ASSET_BINDING_SCHEMA, type ProfileAssetBindingSpec } from "../types/index.js";
import { createConfig } from "./configs.js";
import { getDatabase, resetDatabase } from "./database.js";
import {
  addAssetToProfile,
  createProfile,
  getProfileAssetBindings,
  removeAssetFromProfile,
  setProfileAssetBinding,
} from "./profiles.js";

let db: Database;

beforeEach(() => {
  resetDatabase();
  db = getDatabase(":memory:");
});

function spec(configId: string, version: number, content: string): ProfileAssetBindingSpec {
  return {
    schema: PROFILE_ASSET_BINDING_SCHEMA,
    assetKey: "review-skill",
    kind: "skill",
    enabled: true,
    required: true,
    selector: { provider: "codex", versionRange: ">=0.147.0", surface: "cli", scope: "session" },
    source: {
      kind: "skill",
      locator: configAssetLocator(configId, version),
      digest: configAssetDigest(content),
      immutable: true,
      allowed: true,
    },
    destination: { strategy: "emit-file", root: "target-home", relativePath: "skills/review/SKILL.md" },
    uninstall: "remove-managed",
    rollback: "snapshot",
  };
}

describe("persisted profile asset bindings", () => {
  test("round-trips typed trust, digest, lifecycle, and destination metadata independently of instruction membership", () => {
    const profile = createProfile({ name: "Assets" }, db);
    const source = createConfig({ name: "Review skill", category: "rules", content: "# Review\n" }, db);
    const created = addAssetToProfile(profile.id, source.id, spec(source.id, source.version, source.content), db);

    expect(created).toMatchObject({
      profile_id: profile.id,
      source_config_id: source.id,
      sort_order: 0,
      binding: {
        assetKey: "review-skill",
        enabled: true,
        required: true,
        uninstall: "remove-managed",
        rollback: "snapshot",
      },
    });
    expect(getProfileAssetBindings(profile.slug, db)).toEqual([created]);

    const updated = setProfileAssetBinding(profile.id, "review-skill", {
      ...created.binding,
      enabled: false,
      required: false,
      uninstall: "retain",
    }, db);
    expect(updated.binding).toMatchObject({ enabled: false, required: false, uninstall: "retain" });

    removeAssetFromProfile(profile.id, "review-skill", db);
    expect(getProfileAssetBindings(profile.id, db)).toEqual([]);
  });

  test("rejects duplicate profile asset identities and route/body key mismatches", () => {
    const profile = createProfile({ name: "Assets" }, db);
    const source = createConfig({ name: "Review skill", category: "rules", content: "# Review\n" }, db);
    const binding = spec(source.id, source.version, source.content);
    addAssetToProfile(profile.id, source.id, binding, db);
    expect(() => addAssetToProfile(profile.id, source.id, binding, db)).toThrow();
    expect(() => setProfileAssetBinding(profile.id, "another-key", binding, db)).toThrow(/does not match route key/);
  });
});
