import { afterEach, describe, expect, test } from "bun:test";
import {
  CloudConfigStore,
  CloudHttpError,
  LocalConfigStore,
  LOCAL_OPT_IN_ENV,
  formatCliError,
  isApiTransport,
  isCloudAuthError,
  isLocalOptIn,
  resolveCloudConfig,
  resolveConfigStore,
} from "./config-store.js";
import { assertNoLegacyStorageMode } from "../lib/retired-storage-mode.js";
import type { MachineContext } from "../types/index.js";

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(handler: (call: RecordedCall) => { status?: number; json?: unknown }) {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const h = init?.headers as Record<string, string> | undefined;
    if (h) for (const [k, v] of Object.entries(h)) headers[k] = v;
    const call: RecordedCall = {
      url: String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status = 200, json } = handler(call);
    return new Response(json === undefined ? "" : JSON.stringify(json), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const CONFIG = { apiUrl: "https://instructions.hasna.xyz", apiKey: "test-key-xyz" };
const SAMPLE = {
  id: "cfg-1",
  name: "Demo",
  slug: "demo",
  kind: "file",
  category: "rules",
  agent: "global",
  target_path: null,
  outputs: [],
  format: "markdown",
  content: "hello",
  description: null,
  tags: [],
  is_template: false,
  version: 1,
  created_at: "",
  updated_at: "",
  synced_at: null,
};
const SAMPLE_PROFILE = {
  id: "p1",
  name: "Profile",
  slug: "profile",
  description: null,
  selectors: { hostnames: ["station02"] },
  variables: {},
  created_at: "",
  updated_at: "",
};
const SAMPLE_ASSET = {
  profile_id: "p1",
  source_config_id: "cfg-1",
  sort_order: 0,
  binding: {
    schema: "hasna.instructions.profile-asset-binding/v1" as const,
    assetKey: "review-skill",
    kind: "skill" as const,
    enabled: true,
    required: true,
    selector: { provider: "codex" as const, versionRange: ">=0.147.0", surface: "cli", scope: "session" as const },
    source: {
      kind: "skill" as const,
      locator: "config://cfg-1@1",
      digest: `sha256:${"0".repeat(64)}`,
      immutable: true,
      allowed: true,
    },
    destination: { strategy: "emit-file" as const, root: "target-home" as const, relativePath: "skills/review/SKILL.md" },
    uninstall: "remove-managed" as const,
    rollback: "snapshot" as const,
  },
};
const SAMPLE_MACHINE: MachineContext = {
  id: "machine-1",
  hostname: "station02",
  os: "linux",
  arch: "x64",
  os_family: "linux",
  home_dir: "/tmp",
  workspace_root: "/tmp/workspace",
  bun_bin_dir: "/tmp/bin",
  bun_path: "/tmp/bin/bun",
  path_prefix: "/tmp/bin",
  last_applied_at: null,
  created_at: "",
};

function page<T>(items: T[], total = items.length, limit = 20, cursor = 0) {
  const complete = cursor + items.length >= total;
  return {
    items,
    total,
    limit,
    cursor,
    next_cursor: complete ? null : cursor + items.length,
    has_more: !complete,
    complete,
    truncated: false,
  };
}

let active: { restore(): void } | undefined;
afterEach(() => {
  active?.restore();
  active = undefined;
  delete process.env["HASNA_INSTRUCTIONS_API_URL"];
  delete process.env["HASNA_INSTRUCTIONS_API_KEY"];
});

describe("resolveCloudConfig", () => {
  test("null when neither set", () => {
    expect(resolveCloudConfig({})).toBeNull();
    expect(isApiTransport({})).toBe(false);
  });
  test("config when both set", () => {
    const env = { HASNA_INSTRUCTIONS_API_URL: "https://x", HASNA_INSTRUCTIONS_API_KEY: "k" };
    expect(resolveCloudConfig(env)).toEqual({ apiUrl: "https://x", apiKey: "k" });
    expect(isApiTransport(env)).toBe(true);
  });
  test("throws when only one set (no silent local drift)", () => {
    expect(() => resolveCloudConfig({ HASNA_INSTRUCTIONS_API_URL: "https://x" })).toThrow();
    expect(() => resolveCloudConfig({ HASNA_INSTRUCTIONS_API_KEY: "k" })).toThrow();
  });
  test("exactly-one-set error names the local opt-in instead of a local default", () => {
    expect(() => resolveCloudConfig({ HASNA_INSTRUCTIONS_API_URL: "https://x" })).toThrow(
      new RegExp(LOCAL_OPT_IN_ENV),
    );
  });
});

describe("retired storage-mode variables", () => {
  test("STORAGE_MODE set fails loud naming the retired var", () => {
    expect(() => assertNoLegacyStorageMode({ HASNA_INSTRUCTIONS_STORAGE_MODE: "cloud" })).toThrow(
      /HASNA_INSTRUCTIONS_STORAGE_MODE was removed/,
    );
    expect(() => assertNoLegacyStorageMode({ HASNA_INSTRUCTIONS_STORAGE_MODE: "local" })).toThrow(
      /HASNA_INSTRUCTIONS_STORAGE_MODE was removed/,
    );
    expect(() => assertNoLegacyStorageMode({ INSTRUCTIONS_STORAGE_MODE: "self_hosted" })).toThrow(
      /INSTRUCTIONS_STORAGE_MODE was removed/,
    );
  });
  test("retired var fails loud even when API env is set (no silent drift)", () => {
    const env = {
      HASNA_INSTRUCTIONS_API_URL: "https://x",
      HASNA_INSTRUCTIONS_API_KEY: "k",
      HASNA_INSTRUCTIONS_STORAGE_MODE: "cloud",
    };
    expect(() => resolveConfigStore(env)).toThrow(/HASNA_INSTRUCTIONS_STORAGE_MODE was removed/);
  });
  test("legacy key set to undefined is not a configured value", () => {
    expect(() => assertNoLegacyStorageMode({ HASNA_INSTRUCTIONS_STORAGE_MODE: undefined })).not.toThrow();
  });
});

describe("resolveConfigStore (fail closed without fleet env, owner directive 2026-09-04)", () => {
  test("throws naming the required env when no API env and no local opt-in", () => {
    expect(() => resolveConfigStore({})).toThrow(/HASNA_INSTRUCTIONS_API_URL/);
    expect(() => resolveConfigStore({})).toThrow(/HASNA_INSTRUCTIONS_API_KEY/);
    expect(() => resolveConfigStore({})).toThrow(new RegExp(LOCAL_OPT_IN_ENV));
    // The failure must never silently open the local store.
    expect(() => resolveConfigStore({})).not.toBeInstanceOf(LocalConfigStore);
  });
  test("api transport when both env vars set", () => {
    const store = resolveConfigStore({
      HASNA_INSTRUCTIONS_API_URL: "https://instructions.hasna.xyz",
      HASNA_INSTRUCTIONS_API_KEY: "k",
    });
    expect(store).toBeInstanceOf(CloudConfigStore);
    expect(store.mode).toBe("api");
  });
  test("throws when exactly one API var is set, even with the local opt-in absent", () => {
    expect(() => resolveConfigStore({ HASNA_INSTRUCTIONS_API_URL: "https://x" })).toThrow();
    expect(() => resolveConfigStore({ HASNA_INSTRUCTIONS_API_KEY: "k" })).toThrow();
  });
  test("local store only with the explicit opt-in", () => {
    expect(isLocalOptIn({ [LOCAL_OPT_IN_ENV]: "1" })).toBe(true);
    expect(isLocalOptIn({ [LOCAL_OPT_IN_ENV]: "0" })).toBe(false);
    expect(isLocalOptIn({})).toBe(false);
    const store = resolveConfigStore({ [LOCAL_OPT_IN_ENV]: "1" });
    expect(store).toBeInstanceOf(LocalConfigStore);
    expect(store.mode).toBe("local");
  });
  test("fleet env wins over a stale local opt-in (no split-brain)", () => {
    const store = resolveConfigStore({
      HASNA_INSTRUCTIONS_API_URL: "https://instructions.hasna.xyz",
      HASNA_INSTRUCTIONS_API_KEY: "k",
      [LOCAL_OPT_IN_ENV]: "1",
    });
    expect(store).toBeInstanceOf(CloudConfigStore);
    expect(store.mode).toBe("api");
  });
});

describe("CloudConfigStore CRUD mapping", () => {
  test("listConfigs -> GET /v1/configs with bearer + query", async () => {
    const m = mockFetch(() => ({ json: { configs: [SAMPLE], count: 1 } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const configs = await store.listConfigs({ category: "rules" as never });
    expect(configs).toHaveLength(1);
    expect(m.calls[0].url).toBe("https://instructions.hasna.xyz/v1/configs?category=rules");
    expect(m.calls[0].headers["Authorization"]).toBe("Bearer test-key-xyz");
  });

  test("getConfig -> GET /v1/configs/:id; 404 -> ConfigNotFoundError", async () => {
    const m = mockFetch((c) =>
      c.url.endsWith("/missing") ? { status: 404, json: { error: "not found" } } : { json: { config: SAMPLE } },
    );
    active = m;
    const store = new CloudConfigStore(CONFIG);
    expect((await store.getConfig("demo")).slug).toBe("demo");
    await expect(store.getConfig("missing")).rejects.toThrow();
  });

  test("createConfig -> POST with Idempotency-Key", async () => {
    const m = mockFetch(() => ({ status: 201, json: { config: SAMPLE } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const created = await store.createConfig({ name: "Demo", category: "rules" as never, content: "hello" });
    expect(created.id).toBe("cfg-1");
    expect(m.calls[0].method).toBe("POST");
    expect(m.calls[0].headers["Idempotency-Key"]).toBeTruthy();
  });

  test("updateConfig -> PATCH /v1/configs/:id", async () => {
    const m = mockFetch(() => ({ json: { config: { ...SAMPLE, content: "new" } } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const updated = await store.updateConfig("demo", { content: "new" });
    expect(updated.content).toBe("new");
    expect(m.calls[0].method).toBe("PATCH");
    expect(m.calls[0].body).toEqual({ content: "new" });
  });

  test("deleteConfig -> DELETE; 404 -> throws", async () => {
    const m = mockFetch((c) => (c.url.endsWith("/gone") ? { status: 404 } : { json: { deleted: true } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    await store.deleteConfig("demo");
    expect(m.calls[0].method).toBe("DELETE");
    await expect(store.deleteConfig("gone")).rejects.toThrow();
  });

  test("getConfigStats -> GET /v1/stats", async () => {
    const m = mockFetch(() => ({ json: { total: 3, rules: 3 } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    expect(await store.getConfigStats()).toEqual({ total: 3, rules: 3 });
    expect(m.calls[0].url).toBe("https://instructions.hasna.xyz/v1/stats");
  });

  test("non-2xx surfaces CloudHttpError", async () => {
    const m = mockFetch(() => ({ status: 401, json: { error: "unauthorized" } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    await expect(store.listConfigs()).rejects.toBeInstanceOf(CloudHttpError);
  });

  test("getProfileConfigs -> GET /v1/profiles/:id embeds configs", async () => {
    const m = mockFetch(() => ({ json: { profile: { ...SAMPLE_PROFILE, configs: [SAMPLE] }, configs: page([SAMPLE]) } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const configs = await store.getProfileConfigs("p");
    expect(configs).toHaveLength(1);
  });

  test("getProfile resolves a list-visible profile when direct identity lookup returns 404", async () => {
    const m = mockFetch((call) => {
      if (call.url.endsWith("/v1/profiles/my-setup")) {
        return { status: 404, json: { error: "Profile not found: my-setup" } };
      }
      if (call.url.includes("/v1/profiles?")) {
        return { json: page([{ ...SAMPLE_PROFILE, id: "ae1030fc-4b10-41c7-a127-9d81fccfbac0", slug: "my-setup" }]) };
      }
      return { status: 404, json: { error: "unexpected request" } };
    });
    active = m;
    const store = new CloudConfigStore(CONFIG);

    await expect(store.getProfile("my-setup")).resolves.toMatchObject({
      id: "ae1030fc-4b10-41c7-a127-9d81fccfbac0",
      slug: "my-setup",
    });
    expect(m.calls.map((call) => call.url)).toEqual([
      "https://instructions.hasna.xyz/v1/profiles/my-setup",
      "https://instructions.hasna.xyz/v1/profiles?limit=100&cursor=0",
    ]);
  });

  test("getProfile still rejects an identity absent from both direct and list reads", async () => {
    const m = mockFetch((call) => {
      if (call.url.endsWith("/v1/profiles/missing")) {
        return { status: 404, json: { error: "Profile not found: missing" } };
      }
      if (call.url.includes("/v1/profiles?")) {
        return { json: page([{ ...SAMPLE_PROFILE, id: "p1", slug: "present" }]) };
      }
      return { status: 404, json: { error: "unexpected request" } };
    });
    active = m;
    const store = new CloudConfigStore(CONFIG);

    await expect(store.getProfile("missing")).rejects.toThrow("Profile not found: missing");
  });

  test("profile show follow-up reads use the canonical id after slug recovery", async () => {
    const canonicalId = "ae1030fc-4b10-41c7-a127-9d81fccfbac0";
    const profile = { ...SAMPLE_PROFILE, id: canonicalId, slug: "my-setup" };
    const m = mockFetch((call) => {
      if (call.url.endsWith("/v1/profiles/my-setup")) return { status: 404, json: { error: "Profile not found: my-setup" } };
      if (call.url.includes("/v1/profiles?")) return { json: page([profile]) };
      if (call.url.includes(`/v1/profiles/${canonicalId}?`)) return { json: { profile, configs: page([SAMPLE]) } };
      if (call.url.endsWith(`/v1/profiles/${canonicalId}/assets`)) return { json: { assets: [] } };
      if (call.url.endsWith(`/v1/profiles/${canonicalId}/bindings`)) return { json: { bindings: [] } };
      return { status: 404, json: { error: "unexpected slug follow-up" } };
    });
    active = m;
    const store = new CloudConfigStore(CONFIG);

    const resolved = await store.getProfile("my-setup");
    await store.getProfileConfigsPage(resolved.id);
    await store.getProfileAssetBindings(resolved.id);
    await store.getProfileConfigBindings(resolved.id);

    expect(m.calls.map((call) => call.url)).toEqual([
      "https://instructions.hasna.xyz/v1/profiles/my-setup",
      "https://instructions.hasna.xyz/v1/profiles?limit=100&cursor=0",
      `https://instructions.hasna.xyz/v1/profiles/${canonicalId}?limit=20&cursor=0`,
      `https://instructions.hasna.xyz/v1/profiles/${canonicalId}/assets`,
      `https://instructions.hasna.xyz/v1/profiles/${canonicalId}/bindings`,
    ]);
  });

  test("profile follow-up reads retry the list-visible slug when canonical routes return 404", async () => {
    const canonicalId = "ae1030fc-4b10-41c7-a127-9d81fccfbac0";
    const profile = { ...SAMPLE_PROFILE, id: canonicalId, slug: "my-setup" };
    const m = mockFetch((call) => {
      if (call.url.endsWith(`/v1/profiles/${canonicalId}?limit=20&cursor=0`)) return { status: 404, json: { error: "Profile not found: ae1030" } };
      if (call.url.endsWith(`/v1/profiles/${canonicalId}/assets`)) return { status: 404, json: { error: "Profile not found: ae1030" } };
      if (call.url.endsWith(`/v1/profiles/${canonicalId}/bindings`)) return { status: 404, json: { error: "Profile not found: ae1030" } };
      if (call.url.endsWith(`/v1/profiles/my-setup?limit=20&cursor=0`)) return { json: { profile, configs: page([SAMPLE]) } };
      if (call.url.endsWith(`/v1/profiles/my-setup/assets`)) return { json: { assets: [] } };
      if (call.url.endsWith(`/v1/profiles/my-setup/bindings`)) return { json: { bindings: [] } };
      if (call.url.includes("/v1/profiles?")) return { json: page([profile]) };
      return { status: 404, json: { error: "unexpected request" } };
    });
    active = m;
    const store = new CloudConfigStore(CONFIG);

    await expect(store.getProfileConfigsPage(canonicalId)).resolves.toMatchObject({ items: [SAMPLE] });
    await expect(store.getProfileAssetBindings(canonicalId)).resolves.toEqual([]);
    await expect(store.getProfileConfigBindings(canonicalId)).resolves.toEqual([]);

    expect(m.calls.map((call) => call.url)).toEqual([
      `https://instructions.hasna.xyz/v1/profiles/${canonicalId}?limit=20&cursor=0`,
      "https://instructions.hasna.xyz/v1/profiles?limit=100&cursor=0",
      "https://instructions.hasna.xyz/v1/profiles/my-setup?limit=20&cursor=0",
      `https://instructions.hasna.xyz/v1/profiles/${canonicalId}/assets`,
      "https://instructions.hasna.xyz/v1/profiles?limit=100&cursor=0",
      "https://instructions.hasna.xyz/v1/profiles/my-setup/assets",
      `https://instructions.hasna.xyz/v1/profiles/${canonicalId}/bindings`,
      "https://instructions.hasna.xyz/v1/profiles?limit=100&cursor=0",
      "https://instructions.hasna.xyz/v1/profiles/my-setup/bindings",
    ]);
  });

  test("profile follow-ups preserve a legacy API's embedded configs when bindings and assets routes are absent", async () => {
    const canonicalId = "ae1030fc-4b10-41c7-a127-9d81fccfbac0";
    const profile = { ...SAMPLE_PROFILE, id: canonicalId, slug: "my-setup", configs: [SAMPLE] };
    const m = mockFetch((call) => {
      if (call.url.endsWith(`/v1/profiles/${canonicalId}`) || call.url.endsWith(`/v1/profiles/${canonicalId}?limit=100&cursor=0`)) {
        return { json: { profile } };
      }
      if (call.url.endsWith(`/v1/profiles/${canonicalId}/bindings`) || call.url.endsWith(`/v1/profiles/${canonicalId}/assets`)) {
        return { status: 404, json: { error: "unknown profile action" } };
      }
      if (call.url.includes("/v1/profiles?")) return { json: page([profile]) };
      return { status: 404, json: { error: "unexpected request" } };
    });
    active = m;
    const store = new CloudConfigStore(CONFIG);

    await expect(store.getProfileConfigBindings(canonicalId)).resolves.toEqual([
      { profile_id: canonicalId, config_id: SAMPLE.id, sort_order: 0, binding: expect.objectContaining({ activation: { mode: "always" } }) },
    ]);
    await expect(store.getProfileAssetBindings(canonicalId)).resolves.toEqual([]);
  });

  test("legacy follow-up fallback rejects unknown identities for bindings and assets", async () => {
    const m = mockFetch((call) => {
      if (call.url.endsWith("/v1/profiles/missing/bindings") || call.url.endsWith("/v1/profiles/missing/assets")) {
        return { status: 404, json: { error: "unknown profile action" } };
      }
      if (call.url.includes("/v1/profiles?")) return { json: page([{ ...SAMPLE_PROFILE, id: "p1", slug: "present" }]) };
      return { status: 404, json: { error: "Profile not found: missing" } };
    });
    active = m;
    const store = new CloudConfigStore(CONFIG);

    await expect(store.getProfileConfigBindings("missing")).rejects.toThrow("Profile not found: missing");
    await expect(store.getProfileAssetBindings("missing")).rejects.toThrow("Profile not found: missing");
  });

  test("non-404 malformed follow-up responses do not degrade to an empty legacy result", async () => {
    const m = mockFetch(() => ({ json: { unexpected: true } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);

    await expect(store.getProfileAssetBindings("profile")).rejects.toThrow("invalid response");
    await expect(store.getProfileConfigBindings("profile")).rejects.toThrow("invalid response");
  });

  test("maps profile asset CRUD to the separate cloud API paths", async () => {
    const m = mockFetch((call) => {
      if (call.method === "GET") return { json: { assets: [SAMPLE_ASSET] } };
      if (call.method === "DELETE") return { json: { removed: true } };
      return { status: call.method === "POST" ? 201 : 200, json: { asset: SAMPLE_ASSET } };
    });
    active = m;
    const store = new CloudConfigStore(CONFIG);

    expect(await store.getProfileAssetBindings("p1")).toEqual([SAMPLE_ASSET]);
    expect(await store.addAssetToProfile("p1", "cfg-1", SAMPLE_ASSET.binding)).toEqual(SAMPLE_ASSET);
    expect(await store.setProfileAssetBinding("p1", "review-skill", SAMPLE_ASSET.binding)).toEqual(SAMPLE_ASSET);
    await store.removeAssetFromProfile("p1", "review-skill");

    expect(m.calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "https://instructions.hasna.xyz/v1/profiles/p1/assets"],
      ["POST", "https://instructions.hasna.xyz/v1/profiles/p1/assets"],
      ["PUT", "https://instructions.hasna.xyz/v1/profiles/p1/assets/review-skill"],
      ["DELETE", "https://instructions.hasna.xyz/v1/profiles/p1/assets/review-skill"],
    ]);
    expect(m.calls[1]?.body).toEqual({ source_config_id: "cfg-1", binding: SAMPLE_ASSET.binding });
    expect(m.calls[2]?.body).toEqual({ binding: SAMPLE_ASSET.binding });
    expect(m.calls[1]?.headers["Idempotency-Key"]).toBeTruthy();
    expect(m.calls[2]?.headers["Idempotency-Key"]).toBeTruthy();
  });

  test("listProfilesPage sends producer bounds and requires complete metadata", async () => {
    const m = mockFetch(() => ({ json: page([SAMPLE_PROFILE], 3, 2, 2) }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const result = await store.listProfilesPage({ limit: 2, cursor: 2 });

    expect(m.calls[0].url).toBe("https://instructions.hasna.xyz/v1/profiles?limit=2&cursor=2");
    expect(result).toMatchObject({ total: 3, limit: 2, cursor: 2, complete: true, truncated: false });
  });

  test("getProfileConfigsPage sends membership bounds", async () => {
    const m = mockFetch(() => ({
      json: {
        profile: { ...SAMPLE_PROFILE, configs: [SAMPLE] },
        configs: page([SAMPLE], 5, 2, 4),
      },
    }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const result = await store.getProfileConfigsPage("profile", { limit: 2, cursor: 4 });

    expect(m.calls[0].url).toBe("https://instructions.hasna.xyz/v1/profiles/profile?limit=2&cursor=4");
    expect(result).toMatchObject({ total: 5, cursor: 4, complete: true, truncated: false });
  });

  test("resolveProfileForMachineRead sends the source scan bound", async () => {
    const m = mockFetch(() => ({
      json: {
        profile: SAMPLE_PROFILE,
        scanned: 5,
        total: 5,
        batch_limit: 2,
        complete: true,
        truncated: false,
      },
    }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const result = await store.resolveProfileForMachineRead(SAMPLE_MACHINE, { limit: 2 });

    expect(m.calls[0].url).toBe("https://instructions.hasna.xyz/v1/profiles/resolve?hostname=station02&os=linux&arch=x64&limit=2");
    expect(result).toMatchObject({ scanned: 5, total: 5, batch_limit: 2, complete: true, truncated: false });
  });

  test("new client sends explicit default bounds and safely pages an old server's complete profile array", async () => {
    const legacyProfiles = Array.from({ length: 5 }, (_, index) => ({
      ...SAMPLE_PROFILE,
      id: `p${index + 1}`,
      name: `Profile ${index + 1}`,
      slug: `profile-${index + 1}`,
    }));
    const m = mockFetch(() => ({ json: { profiles: legacyProfiles, count: legacyProfiles.length } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const result = await store.listProfilesPage();

    expect(m.calls[0].url).toBe("https://instructions.hasna.xyz/v1/profiles?limit=20&cursor=0");
    expect(result.items.map((profile) => profile.slug)).toEqual(legacyProfiles.map((profile) => profile.slug));
    expect(result).toMatchObject({
      total: 5,
      limit: 20,
      cursor: 0,
      complete: true,
      truncated: false,
    });
  });

  test("new client safely pages an old server's complete embedded profile membership", async () => {
    const legacyConfigs = Array.from({ length: 5 }, (_, index) => ({
      ...SAMPLE,
      id: `cfg-${index + 1}`,
      name: `Config ${index + 1}`,
      slug: `config-${index + 1}`,
    }));
    const m = mockFetch(() => ({
      json: { profile: { ...SAMPLE_PROFILE, configs: legacyConfigs } },
    }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const result = await store.getProfileConfigsPage("profile", { limit: 2, cursor: 2 });

    expect(m.calls[0].url).toBe("https://instructions.hasna.xyz/v1/profiles/profile?limit=2&cursor=2");
    expect(result.items.map((config) => config.slug)).toEqual(["config-3", "config-4"]);
    expect(result).toMatchObject({
      total: 5,
      limit: 2,
      cursor: 2,
      next_cursor: 4,
      complete: false,
      truncated: false,
    });
  });

  test("new client labels an old server's complete resolver response without inventing bounded counts", async () => {
    const m = mockFetch(() => ({ json: { profile: SAMPLE_PROFILE } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const result = await store.resolveProfileForMachineRead(
      { ...SAMPLE_MACHINE, os: null, arch: null },
      { limit: 2 },
    );

    expect(m.calls[0].url).toBe("https://instructions.hasna.xyz/v1/profiles/resolve?hostname=station02&limit=2");
    expect(result).toMatchObject({
      profile: SAMPLE_PROFILE,
      scanned: null,
      total: null,
      batch_limit: null,
      source_bounded: false,
      complete: true,
      truncated: false,
    });
  });

  test("new client safely maps an old server's no-match 404 to a complete legacy result", async () => {
    const m = mockFetch(() => ({ status: 404, json: { error: "no matching machine-aware profile" } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    const result = await store.resolveProfileForMachineRead({ ...SAMPLE_MACHINE, hostname: "missing" }, { limit: 2 });

    expect(result).toMatchObject({
      profile: null,
      scanned: null,
      total: null,
      batch_limit: null,
      source_bounded: false,
      complete: true,
      truncated: false,
    });
  });
});

describe("revoked / invalid API key handling", () => {
  const AUTH_ENV = {
    HASNA_INSTRUCTIONS_API_URL: "https://instructions.hasna.xyz",
    HASNA_INSTRUCTIONS_API_KEY: "revoked-key",
  };

  test("isCloudAuthError only matches 401/403 CloudHttpError", () => {
    expect(isCloudAuthError(new CloudHttpError(401, "API key has been revoked"))).toBe(true);
    expect(isCloudAuthError(new CloudHttpError(403, "forbidden"))).toBe(true);
    expect(isCloudAuthError(new CloudHttpError(500, "boom"))).toBe(false);
    expect(isCloudAuthError(new CloudHttpError(404, "not found"))).toBe(false);
    expect(isCloudAuthError(new Error("network down"))).toBe(false);
  });

  test("formatCliError rewrites a revoked-key error into an actionable re-auth message", () => {
    const msg = formatCliError(new CloudHttpError(401, "API key has been revoked"), AUTH_ENV);
    expect(msg).toContain("authentication failed");
    expect(msg).toContain("API key has been revoked");
    expect(msg).toContain("HASNA_INSTRUCTIONS_API_KEY");
    expect(msg).toContain("https://instructions.hasna.xyz");
    // offers both a re-auth and a local-store fallback path
    expect(msg).toContain("export HASNA_INSTRUCTIONS_API_KEY=");
    expect(msg).toContain("export HASNA_INSTRUCTIONS_LOCAL=1");
  });

  test("formatCliError leaves non-auth errors as plain messages", () => {
    expect(formatCliError(new CloudHttpError(500, "internal error"), AUTH_ENV)).toBe("internal error");
    expect(formatCliError(new Error("disk full"))).toBe("disk full");
    expect(formatCliError("raw string")).toBe("raw string");
  });

  test("formatCliError omits the generic HTTP fallback note but keeps guidance", () => {
    const msg = formatCliError(new CloudHttpError(401, "HTTP 401 on GET /configs"), AUTH_ENV);
    expect(msg).not.toContain("Server said:");
    expect(msg).toContain("missing, expired, or revoked");
  });

  test("cloud list path with revoked key surfaces an auth error that formats cleanly", async () => {
    const m = mockFetch(() => ({ status: 401, json: { error: "API key has been revoked" } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    try {
      await store.listConfigs();
      throw new Error("expected listConfigs to reject");
    } catch (err) {
      expect(isCloudAuthError(err)).toBe(true);
      const shown = formatCliError(err, AUTH_ENV);
      expect(shown).toContain("authentication failed");
      expect(shown).toContain("export HASNA_INSTRUCTIONS_LOCAL=1");
    }
  });

  test("cloud create path with revoked key surfaces an auth error that formats cleanly", async () => {
    const m = mockFetch(() => ({ status: 401, json: { error: "API key has been revoked" } }));
    active = m;
    const store = new CloudConfigStore(CONFIG);
    try {
      await store.createConfig({ name: "Demo", category: "rules" as never, content: "hello" });
      throw new Error("expected createConfig to reject");
    } catch (err) {
      expect(isCloudAuthError(err)).toBe(true);
      const shown = formatCliError(err, AUTH_ENV);
      expect(shown).toContain("export HASNA_INSTRUCTIONS_API_KEY=");
    }
  });
});
