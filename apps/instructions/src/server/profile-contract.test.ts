import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cloud from "./cloud.js";
import * as store from "../storage/cloud-store.js";
import type { Config, Profile, ProfileAssetBinding, ProfileConfigBinding } from "../types/index.js";
import { buildV1OpenApiDocument } from "./openapi.js";
import { handleV1Request } from "./v1.js";

const spies: Array<{ mockRestore(): void }> = [];

function track<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy);
  return spy;
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore();
});

const profiles: Profile[] = Array.from({ length: 25 }, (_, index) => ({
  id: `profile-${index + 1}`,
  name: `Profile ${index + 1}`,
  slug: `profile-${index + 1}`,
  description: null,
  selectors: {},
  variables: {},
  created_at: "",
  updated_at: "",
}));

const configs: Config[] = Array.from({ length: 25 }, (_, index) => ({
  id: `config-${index + 1}`,
  name: `Config ${index + 1}`,
  slug: `config-${index + 1}`,
  kind: "file",
  category: "rules",
  agent: "global",
  target_path: null,
  outputs: [],
  format: "markdown",
  content: "",
  description: null,
  tags: [],
  is_template: false,
  version: 1,
  created_at: "",
  updated_at: "",
  synced_at: null,
}));

function mockCloudBoundary() {
  track(spyOn(cloud, "ensureCloudSchema").mockResolvedValue(undefined));
  track(spyOn(cloud, "getCloudClient").mockReturnValue({} as never));
}

describe("mixed-version profile HTTP compatibility", () => {
  test("old client list request receives every legacy profile instead of the default bounded page", async () => {
    mockCloudBoundary();
    track(spyOn(store, "listProfiles").mockResolvedValue(profiles));
    track(spyOn(store, "listProfilesPage").mockResolvedValue({
      items: profiles.slice(0, 20),
      total: profiles.length,
      limit: 20,
      cursor: 0,
      next_cursor: 20,
      has_more: true,
      complete: false,
      truncated: false,
      source_bounded: true,
    }));

    const response = await handleV1Request(
      new Request("https://instructions.hasna.xyz/v1/profiles"),
      new URL("https://instructions.hasna.xyz/v1/profiles"),
    );
    const payload = await response?.json() as { profiles: unknown[]; items: unknown[]; complete: boolean };

    expect(payload.profiles).toHaveLength(25);
    expect(payload.items).toHaveLength(25);
    expect(payload.complete).toBe(true);
  });

  test("old client show request receives every embedded config instead of the default bounded page", async () => {
    mockCloudBoundary();
    track(spyOn(store, "getProfile").mockResolvedValue(profiles[0]!));
    track(spyOn(store, "getProfileConfigs").mockResolvedValue(configs));
    track(spyOn(store, "getProfileConfigsPage").mockResolvedValue({
      items: configs.slice(0, 20),
      total: configs.length,
      limit: 20,
      cursor: 0,
      next_cursor: 20,
      has_more: true,
      complete: false,
      truncated: false,
      source_bounded: true,
    }));

    const response = await handleV1Request(
      new Request("https://instructions.hasna.xyz/v1/profiles/profile-1"),
      new URL("https://instructions.hasna.xyz/v1/profiles/profile-1"),
    );
    const payload = await response?.json() as {
      profile: { configs: unknown[] };
      configs: { items: unknown[]; complete: boolean };
    };

    expect(payload.profile.configs).toHaveLength(25);
    expect(payload.configs.items).toHaveLength(25);
    expect(payload.configs.complete).toBe(true);
  });

  test("profile membership handlers match the documented success statuses and envelopes", async () => {
    mockCloudBoundary();
    const add = track(spyOn(store, "addConfigToProfile").mockResolvedValue(undefined));
    const remove = track(spyOn(store, "removeConfigFromProfile").mockResolvedValue(undefined));

    const addResponse = await handleV1Request(
      new Request("https://instructions.hasna.xyz/v1/profiles/profile-1/configs", {
        method: "POST",
        body: JSON.stringify({ config_id: "config-2" }),
      }),
      new URL("https://instructions.hasna.xyz/v1/profiles/profile-1/configs"),
    );
    const removeResponse = await handleV1Request(
      new Request("https://instructions.hasna.xyz/v1/profiles/profile-1/configs/config-2", {
        method: "DELETE",
      }),
      new URL("https://instructions.hasna.xyz/v1/profiles/profile-1/configs/config-2"),
    );

    expect(addResponse?.status).toBe(200);
    expect(await addResponse?.json()).toEqual({ added: true });
    expect(add).toHaveBeenCalledWith(expect.anything(), "profile-1", "config-2");
    expect(removeResponse?.status).toBe(200);
    expect(await removeResponse?.json()).toEqual({ removed: true });
    expect(remove).toHaveBeenCalledWith(expect.anything(), "profile-1", "config-2");
  });

  test("profile binding handlers persist and return the schema-versioned binding", async () => {
    mockCloudBoundary();
    const binding: ProfileConfigBinding = {
      profile_id: "profile-1",
      config_id: "config-2",
      sort_order: 0,
      binding: {
        schema: "hasna.instructions.profile-config-binding/v1",
        activation: { mode: "glob", globs: ["**/*.ts"] },
        required: true,
        fallback: "fail",
      },
    };
    const list = track(spyOn(store, "getProfileConfigBindings").mockResolvedValue([binding]));
    const set = track(spyOn(store, "setProfileConfigBinding").mockResolvedValue(binding));
    const listResponse = await handleV1Request(
      new Request("https://instructions.hasna.xyz/v1/profiles/profile-1/bindings"),
      new URL("https://instructions.hasna.xyz/v1/profiles/profile-1/bindings"),
    );
    const setResponse = await handleV1Request(
      new Request("https://instructions.hasna.xyz/v1/profiles/profile-1/configs/config-2", {
        method: "PUT",
        body: JSON.stringify({ binding: binding.binding }),
      }),
      new URL("https://instructions.hasna.xyz/v1/profiles/profile-1/configs/config-2"),
    );
    expect(await listResponse?.json()).toEqual({ bindings: [binding] });
    expect(list).toHaveBeenCalledWith(expect.anything(), "profile-1");
    expect(await setResponse?.json()).toEqual({ binding });
    expect(set).toHaveBeenCalledWith(expect.anything(), "profile-1", "config-2", binding.binding);
  });

  test("profile asset handlers preserve the separate schema-versioned asset lifecycle", async () => {
    mockCloudBoundary();
    const asset: ProfileAssetBinding = {
      profile_id: "profile-1",
      source_config_id: "config-2",
      sort_order: 0,
      binding: {
        schema: "hasna.instructions.profile-asset-binding/v1",
        assetKey: "review-skill",
        kind: "skill",
        enabled: true,
        required: true,
        selector: { provider: "codex", versionRange: ">=0.147.0", surface: "cli", scope: "session" },
        source: {
          kind: "skill",
          locator: "config://config-2@1",
          digest: `sha256:${"0".repeat(64)}`,
          immutable: true,
          allowed: true,
        },
        destination: { strategy: "emit-file", root: "target-home", relativePath: "skills/review/SKILL.md" },
        uninstall: "remove-managed",
        rollback: "snapshot",
      },
    };
    const list = track(spyOn(store, "getProfileAssetBindings").mockResolvedValue([asset]));
    const add = track(spyOn(store, "addAssetToProfile").mockResolvedValue(asset));
    const set = track(spyOn(store, "setProfileAssetBinding").mockResolvedValue(asset));
    const remove = track(spyOn(store, "removeAssetFromProfile").mockResolvedValue(undefined));

    const listResponse = await handleV1Request(
      new Request("https://instructions.hasna.xyz/v1/profiles/profile-1/assets"),
      new URL("https://instructions.hasna.xyz/v1/profiles/profile-1/assets"),
    );
    const addResponse = await handleV1Request(
      new Request("https://instructions.hasna.xyz/v1/profiles/profile-1/assets", {
        method: "POST",
        body: JSON.stringify({ source_config_id: "config-2", binding: asset.binding }),
      }),
      new URL("https://instructions.hasna.xyz/v1/profiles/profile-1/assets"),
    );
    const setResponse = await handleV1Request(
      new Request("https://instructions.hasna.xyz/v1/profiles/profile-1/assets/review-skill", {
        method: "PUT",
        body: JSON.stringify({ binding: asset.binding }),
      }),
      new URL("https://instructions.hasna.xyz/v1/profiles/profile-1/assets/review-skill"),
    );
    const removeResponse = await handleV1Request(
      new Request("https://instructions.hasna.xyz/v1/profiles/profile-1/assets/review-skill", { method: "DELETE" }),
      new URL("https://instructions.hasna.xyz/v1/profiles/profile-1/assets/review-skill"),
    );

    expect(await listResponse?.json()).toEqual({ assets: [asset] });
    expect(list).toHaveBeenCalledWith(expect.anything(), "profile-1");
    expect(addResponse?.status).toBe(201);
    expect(await addResponse?.json()).toEqual({ asset });
    expect(add).toHaveBeenCalledWith(expect.anything(), "profile-1", "config-2", asset.binding);
    expect(await setResponse?.json()).toEqual({ asset });
    expect(set).toHaveBeenCalledWith(expect.anything(), "profile-1", "review-skill", asset.binding);
    expect(await removeResponse?.json()).toEqual({ removed: true });
    expect(remove).toHaveBeenCalledWith(expect.anything(), "profile-1", "review-skill");
  });
});

describe("profile OpenAPI and generated SDK contract", () => {
  test("documents bounded list, show membership, and resolve response envelopes", () => {
    const spec = buildV1OpenApiDocument("test") as any;
    const schemas = spec.components.schemas;
    const listResponse = spec.paths["/v1/profiles"].get.responses["200"].content["application/json"].schema;
    const showResponse = spec.paths["/v1/profiles/{id}"].get.responses["200"].content["application/json"].schema;
    const resolveResponse = spec.paths["/v1/profiles/resolve"].get.responses["200"].content["application/json"].schema;

    expect(schemas.BoundedProfilePage).toBeDefined();
    expect(schemas.BoundedConfigPage).toBeDefined();
    expect(schemas.ProfileResolutionRead).toBeDefined();
    expect(listResponse.$ref).toBe("#/components/schemas/BoundedProfilePage");
    expect(schemas.BoundedProfilePage.properties.items.items.$ref).toBe("#/components/schemas/Profile");
    expect(showResponse.$ref).toBe("#/components/schemas/ProfileShowResponse");
    expect(schemas.ProfileShowResponse.properties.configs.$ref).toBe("#/components/schemas/BoundedConfigPage");
    expect(resolveResponse.$ref).toBe("#/components/schemas/ProfileResolutionRead");
  });

  test("documents authenticated profile membership add and remove operations", () => {
    const spec = buildV1OpenApiDocument("test") as any;
    const addPath = spec.paths["/v1/profiles/{id}/configs"];
    const removePath = spec.paths["/v1/profiles/{id}/configs/{configId}"];
    const add = addPath.post;
    const remove = removePath.delete;

    expect(spec.security).toEqual([{ apiKey: [] }]);
    expect(add.security).toEqual([{ apiKey: [] }]);
    expect(add.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ]);
    expect(add.requestBody.required).toBe(true);
    expect(add.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/AddProfileConfigInput",
    );
    expect(add.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ProfileConfigAddedResponse",
    );

    expect(remove.security).toEqual([{ apiKey: [] }]);
    expect(remove.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { name: "configId", in: "path", required: true, schema: { type: "string" } },
    ]);
    expect(remove.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ProfileConfigRemovedResponse",
    );

    expect(addPath.get).toBeUndefined();
    expect(removePath.post).toBeUndefined();
    expect(spec.paths["/v1/profiles/{id}/bindings"].get.operationId).toBe("getProfileConfigBindings");
    expect(removePath.put.operationId).toBe("setProfileConfigBinding");
    expect(removePath.put.security).toEqual([{ apiKey: [] }]);
  });

  test("tracked generated SDK exposes bounded profile list, show, and resolve methods", () => {
    const generated = readFileSync(join(import.meta.dir, "../../sdk/src/v1.generated.ts"), "utf8");

    expect(generated).toContain("export interface BoundedProfilePage");
    expect(generated).toContain("export interface BoundedConfigPage");
    expect(generated).toContain("export interface ProfileResolutionRead");
    expect(generated).toContain("async listProfiles(query?:");
    expect(generated).toContain("async getProfile(id: string, query?:");
    expect(generated).toContain("async resolveProfile(query?:");
    expect(generated).toContain('"next_cursor": number | null');
    expect(generated).toContain('"scanned": number | null');
    expect(generated).toContain('"batch_limit": number | null');
  });

  test("tracked generated SDK exposes the implemented profile membership and binding operations", () => {
    const generated = readFileSync(join(import.meta.dir, "../../sdk/src/v1.generated.ts"), "utf8");

    expect(generated).toContain("export interface AddProfileConfigInput");
    expect(generated).toContain("export interface ProfileConfigAddedResponse");
    expect(generated).toContain("export interface ProfileConfigRemovedResponse");
    expect(generated).toContain("async addConfigToProfile(id: string, body: AddProfileConfigInput");
    expect(generated).toContain("async getProfileConfigBindings(id: string");
    expect(generated).toContain("async setProfileConfigBinding(id: string, configId: string");
    expect(generated).toContain("async removeConfigFromProfile(id: string, configId: string");
    expect(generated).not.toContain("async replaceConfigInProfile(");
  });

  test("documents and generates the profile asset binding API", () => {
    const spec = buildV1OpenApiDocument("test") as any;
    expect(spec.components.schemas.ProfileAssetBindingSpec.properties.kind.enum).toEqual([
      "skill",
      "workflow",
      "plugin",
      "extension",
      "hook",
      "custom-agent",
    ]);
    expect(spec.paths["/v1/profiles/{id}/assets"].get.operationId).toBe("getProfileAssetBindings");
    expect(spec.paths["/v1/profiles/{id}/assets"].post.operationId).toBe("addAssetToProfile");
    expect(spec.paths["/v1/profiles/{id}/assets/{assetKey}"].put.operationId).toBe("setProfileAssetBinding");
    expect(spec.paths["/v1/profiles/{id}/assets/{assetKey}"].delete.operationId).toBe("removeAssetFromProfile");

    const generated = readFileSync(join(import.meta.dir, "../../sdk/src/v1.generated.ts"), "utf8");
    expect(generated).toContain("export interface ProfileAssetBindingSpec");
    expect(generated).toContain("export interface ProfileAssetBinding");
    expect(generated).toContain("async getProfileAssetBindings(id: string");
    expect(generated).toContain("async addAssetToProfile(id: string, body: AddProfileAssetInput");
    expect(generated).toContain("async setProfileAssetBinding(id: string, assetKey: string");
    expect(generated).toContain("async removeAssetFromProfile(id: string, assetKey: string");
  });
});
