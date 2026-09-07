import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudConfigStore,
  LocalConfigStore,
  LOCAL_OPT_IN_ENV,
  formatCliError,
  isApiTransport,
  isCloudAuthError,
  isLocalOptIn,
  resolveConfigStore,
} from "./config-store.js";
import type { InstructionsStorageClient } from "../lib/client-types.js";
import type { MachineContext } from "../types/index.js";

// ── Hermetic seam helpers ─────────────────────────────────────────────────────
// Every resolution here runs on a CALLER-BUILT env, which is hermetic in the
// shared @hasna/contracts seam: it reaches neither the machine's Keychain nor
// its disk unless this file hands it a runner or a temp HASNA_HOME root.

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A fresh temp home for the disk tier (and for the fail-closed probes). */
function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `inst-config-${label}-`));
  tempRoots.push(root);
  return root;
}

const API_URL_ENV = "HASNA_INSTRUCTIONS_API_URL";
const API_KEY_ENV = "HASNA_INSTRUCTIONS_API_KEY";

interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  idempotencyKey: string | undefined;
}

/**
 * A fake contracts storage client. Records every call the store makes; the
 * handler decides the response (`status` 404 throws the transport's
 * not-found error shape; anything non-2xx is a transport error shape; the
 * default is 200 with `json`).
 */
function fakeStorageClient(
  handler: (call: RecordedCall) => { status?: number; json?: unknown } = () => ({ json: {} }),
): { client: InstructionsStorageClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const request = async <T>(method: string, path: string, body?: unknown, opts?: { idempotencyKey?: string }): Promise<T> => {
    const call: RecordedCall = { method: method.toUpperCase(), path, body, idempotencyKey: opts?.idempotencyKey };
    calls.push(call);
    const { status = 200, json } = handler(call);
    const error = Object.assign(new Error(`Hasna cloud request failed: ${method} ${path} -> ${status}`), {
      name: "HasnaHttpError",
      status,
      body: undefined,
    });
    if (status === 404) throw error;
    if (status >= 400) throw error;
    return json as T;
  };
  const transport = {
    baseUrl: "https://instructions.hasna.xyz/v1",
    request,
    get: <T>(path: string, opts?: { idempotencyKey?: string }) => request<T>("GET", path, undefined, opts),
    post: <T>(path: string, body?: unknown, opts?: { idempotencyKey?: string }) => request<T>("POST", path, body, opts),
    put: <T>(path: string, body?: unknown, opts?: { idempotencyKey?: string }) => request<T>("PUT", path, body, opts),
    patch: <T>(path: string, body?: unknown, opts?: { idempotencyKey?: string }) => request<T>("PATCH", path, body, opts),
    del: <T>(path: string, body?: unknown, opts?: { idempotencyKey?: string }) => request<T>("DELETE", path, body, opts),
  };
  return {
    client: { name: "instructions", baseUrl: transport.baseUrl, transport } as InstructionsStorageClient,
    calls,
  };
}

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

describe("resolveConfigStore (fail closed without a hosted credential, owner directive 2026-09-04)", () => {
  test("throws REMOTE_API_CONFIG_MISSING naming the required env when nothing resolves and no opt-in", () => {
    expect(() => resolveConfigStore({ HOME: tempHome("noenv") })).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(() => resolveConfigStore({ HOME: tempHome("noenv2") })).toThrow(/HASNA_INSTRUCTIONS_API_URL/);
    expect(() => resolveConfigStore({ HOME: tempHome("noenv3") })).toThrow(/HASNA_INSTRUCTIONS_API_KEY/);
    expect(() => resolveConfigStore({ HOME: tempHome("noenv4") })).toThrow(new RegExp(LOCAL_OPT_IN_ENV));
    // The failure must never silently open the local store.
    expect(() => resolveConfigStore({ HOME: tempHome("noenv5") })).not.toBeInstanceOf(LocalConfigStore);
  });

  test("api transport when the canonical env pair is set", () => {
    const store = resolveConfigStore({
      HOME: tempHome("pair"),
      [API_URL_ENV]: "https://instructions.hasna.xyz",
      [API_KEY_ENV]: "k",
    });
    expect(store).toBeInstanceOf(CloudConfigStore);
    expect(store.mode).toBe("api");
    expect(store.v1BaseUrl).toBe("https://instructions.hasna.xyz/v1");
  });

  test("a key alone now resolves the default fleet gateway (no URL half-pair refusal)", () => {
    const store = resolveConfigStore({ HOME: tempHome("keyonly"), [API_KEY_ENV]: "k" });
    expect(store).toBeInstanceOf(CloudConfigStore);
    expect(store.v1BaseUrl).toBe("https://api.hasna.com/instructions/v1");
  });

  test("an authority with no key fails loud (REMOTE_API_KEY_MISSING), even with the local opt-in present", () => {
    expect(() =>
      resolveConfigStore({ HOME: tempHome("urlonly"), [API_URL_ENV]: "https://x", [LOCAL_OPT_IN_ENV]: "1" }),
    ).toThrow(/REMOTE_API_KEY_MISSING/);
  });

  test("local store only with the explicit opt-in", () => {
    expect(isLocalOptIn({ [LOCAL_OPT_IN_ENV]: "1" })).toBe(true);
    expect(isLocalOptIn({ [LOCAL_OPT_IN_ENV]: "0" })).toBe(false);
    expect(isLocalOptIn({})).toBe(false);
    const store = resolveConfigStore({ [LOCAL_OPT_IN_ENV]: "1" });
    expect(store).toBeInstanceOf(LocalConfigStore);
    expect(store.mode).toBe("local");
    expect(store.v1BaseUrl).toBeNull();
  });

  test("a configured environment outranks a stale local opt-in (no split-brain)", () => {
    const store = resolveConfigStore({
      HOME: tempHome("outrank"),
      [API_URL_ENV]: "https://instructions.hasna.xyz",
      [API_KEY_ENV]: "k",
      [LOCAL_OPT_IN_ENV]: "1",
    });
    expect(store).toBeInstanceOf(CloudConfigStore);
    expect(store.mode).toBe("api");
  });

  test("the opt-in short-circuit reads neither the Keychain nor the credential file", () => {
    // A resolvable credential exists on disk but the opt-in answers first and
    // WITHOUT consulting the resolver — so the temp disk tier is never read.
    const home = tempHome("opt-in-hermetic");
    const store = resolveConfigStore({ HOME: home, [LOCAL_OPT_IN_ENV]: "1" });
    expect(store).toBeInstanceOf(LocalConfigStore);
  });

  test("declared-but-blank authority variables count as unset for the opt-in", () => {
    const store = resolveConfigStore({
      HOME: tempHome("blanks"),
      [API_URL_ENV]: "",
      [API_KEY_ENV]: "",
      [LOCAL_OPT_IN_ENV]: "1",
    });
    expect(store).toBeInstanceOf(LocalConfigStore);
  });
});

describe("retired storage-mode variables are GONE (no mode switches exist)", () => {
  test("a retired *_MODE variable no longer refuses anything", () => {
    // Pre-adoption this threw "was removed". The mode vocabulary is gone: the
    // variable is simply never read, and what decides is what RESOLVES.
    expect(() =>
      resolveConfigStore({
        HOME: tempHome("moded1"),
        HASNA_INSTRUCTIONS_STORAGE_MODE: "cloud",
      }),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(() =>
      resolveConfigStore({
        HOME: tempHome("moded2"),
        INSTRUCTIONS_MODE: "local",
      }),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(() =>
      resolveConfigStore({
        HOME: tempHome("moded3"),
        HASNA_INSTRUCTIONS_STORAGE_MODE: "cloud",
        [API_KEY_ENV]: "k",
      }),
    ).not.toThrow();
    expect(
      resolveConfigStore({
        HOME: tempHome("moded4"),
        HASNA_INSTRUCTIONS_STORAGE_MODE: "cloud",
        [API_KEY_ENV]: "k",
      }),
    ).toBeInstanceOf(CloudConfigStore);
  });
});

describe("CloudConfigStore CRUD mapping (over the contracts transport)", () => {
  const make = (handler: (call: RecordedCall) => { status?: number; json?: unknown }) => {
    const { client, calls } = fakeStorageClient(handler);
    return { store: new CloudConfigStore(client), calls };
  };

  test("listConfigs -> GET /v1/configs with query; the transport owns the auth headers", async () => {
    const m = fakeStorageClient(() => ({ json: { configs: [SAMPLE], count: 1 } }));
    const store = new CloudConfigStore(m.client);
    const configs = await store.listConfigs({ category: "rules" as never });
    expect(configs).toHaveLength(1);
    expect(m.calls[0]).toMatchObject({ method: "GET", path: "/configs?category=rules" });
    // The credential + auth headers are the transport's job; the store never
    // touches them (no hand-rolled Authorization header remains).
    expect(JSON.stringify(m.calls[0])).not.toContain("Bearer");
  });

  test("getConfig -> GET /v1/configs/:id; 404 -> ConfigNotFoundError", async () => {
    const m = fakeStorageClient((c) =>
      c.path.endsWith("/missing") ? { status: 404, json: { error: "not found" } } : { json: { config: SAMPLE } },
    );
    const store = new CloudConfigStore(m.client);
    expect((await store.getConfig("demo")).slug).toBe("demo");
    await expect(store.getConfig("missing")).rejects.toThrow();
  });

  test("createConfig -> POST with a transport Idempotency-Key option", async () => {
    const m = fakeStorageClient(() => ({ status: 201, json: { config: SAMPLE } }));
    const store = new CloudConfigStore(m.client);
    const created = await store.createConfig({ name: "Demo", category: "rules" as never, content: "hello" });
    expect(created.id).toBe("cfg-1");
    expect(m.calls[0].method).toBe("POST");
    expect(m.calls[0].path).toBe("/configs");
    expect(m.calls[0].idempotencyKey).toBeTruthy();
    expect(m.calls[0].body).toEqual({ name: "Demo", category: "rules", content: "hello" });
  });

  test("updateConfig -> PATCH /v1/configs/:id", async () => {
    const m = fakeStorageClient(() => ({ json: { config: { ...SAMPLE, content: "new" } } }));
    const store = new CloudConfigStore(m.client);
    const updated = await store.updateConfig("demo", { content: "new" });
    expect(updated.content).toBe("new");
    expect(m.calls[0]).toMatchObject({ method: "PATCH", path: "/configs/demo" });
    expect(m.calls[0].body).toEqual({ content: "new" });
  });

  test("deleteConfig -> DELETE; 404 -> throws", async () => {
    const m = fakeStorageClient((c) => (c.path.endsWith("/gone") ? { status: 404 } : { json: { deleted: true } }));
    const store = new CloudConfigStore(m.client);
    await store.deleteConfig("demo");
    expect(m.calls[0].method).toBe("DELETE");
    await expect(store.deleteConfig("gone")).rejects.toThrow();
  });

  test("getConfigStats -> GET /v1/stats", async () => {
    const m = fakeStorageClient(() => ({ json: { total: 3, rules: 3 } }));
    const store = new CloudConfigStore(m.client);
    expect(await store.getConfigStats()).toEqual({ total: 3, rules: 3 });
    expect(m.calls[0].path).toBe("/stats");
  });

  test("non-2xx surfaces the transport error (HasnaHttpError shape)", async () => {
    const m = fakeStorageClient(() => ({ status: 401, json: { error: "unauthorized" } }));
    const store = new CloudConfigStore(m.client);
    await expect(store.listConfigs()).rejects.toMatchObject({ name: "HasnaHttpError", status: 401 });
  });

  test("getProfileConfigs -> GET /v1/profiles/:id embeds configs", async () => {
    const m = fakeStorageClient(() => ({
      json: { profile: { ...SAMPLE_PROFILE, configs: [SAMPLE] }, configs: page([SAMPLE]) },
    }));
    const store = new CloudConfigStore(m.client);
    const configs = await store.getProfileConfigs("p");
    expect(configs).toHaveLength(1);
  });

  test("getProfile resolves a list-visible profile when direct identity lookup returns 404", async () => {
    const m = fakeStorageClient((call) => {
      if (call.path === "/profiles/my-setup") return { status: 404, json: { error: "Profile not found: my-setup" } };
      if (call.path.includes("/profiles?")) {
        return { json: page([{ ...SAMPLE_PROFILE, id: "ae1030fc-4b10-41c7-a127-9d81fccfbac0", slug: "my-setup" }]) };
      }
      return { status: 404, json: { error: "unexpected request" } };
    });
    const store = new CloudConfigStore(m.client);

    await expect(store.getProfile("my-setup")).resolves.toMatchObject({
      id: "ae1030fc-4b10-41c7-a127-9d81fccfbac0",
      slug: "my-setup",
    });
    expect(m.calls.map((call) => call.path)).toEqual([
      "/profiles/my-setup",
      "/profiles?limit=100&cursor=0",
    ]);
  });

  test("getProfile still rejects an identity absent from both direct and list reads", async () => {
    const m = fakeStorageClient((call) => {
      if (call.path.endsWith("/profiles/missing")) return { status: 404, json: { error: "Profile not found: missing" } };
      if (call.path.includes("/profiles?")) return { json: page([{ ...SAMPLE_PROFILE, id: "p1", slug: "present" }]) };
      return { status: 404, json: { error: "unexpected request" } };
    });
    const store = new CloudConfigStore(m.client);

    await expect(store.getProfile("missing")).rejects.toThrow("Profile not found: missing");
  });

  test("profile show follow-up reads use the canonical id after slug recovery", async () => {
    const canonicalId = "ae1030fc-4b10-41c7-a127-9d81fccfbac0";
    const profile = { ...SAMPLE_PROFILE, id: canonicalId, slug: "my-setup" };
    const m = fakeStorageClient((call) => {
      if (call.path.endsWith("/profiles/my-setup")) return { status: 404, json: { error: "Profile not found: my-setup" } };
      if (call.path.includes("/profiles?")) return { json: page([profile]) };
      if (call.path.includes(`/profiles/${canonicalId}?`)) return { json: { profile, configs: page([SAMPLE]) } };
      if (call.path.endsWith(`/profiles/${canonicalId}/assets`)) return { json: { assets: [] } };
      if (call.path.endsWith(`/profiles/${canonicalId}/bindings`)) return { json: { bindings: [] } };
      return { status: 404, json: { error: "unexpected slug follow-up" } };
    });
    const store = new CloudConfigStore(m.client);

    const resolved = await store.getProfile("my-setup");
    await store.getProfileConfigsPage(resolved.id);
    await store.getProfileAssetBindings(resolved.id);
    await store.getProfileConfigBindings(resolved.id);

    expect(m.calls.map((call) => call.path)).toEqual([
      "/profiles/my-setup",
      "/profiles?limit=100&cursor=0",
      `/profiles/${canonicalId}?limit=20&cursor=0`,
      `/profiles/${canonicalId}/assets`,
      `/profiles/${canonicalId}/bindings`,
    ]);
  });

  test("profile follow-up reads retry the list-visible slug when canonical routes return 404", async () => {
    const canonicalId = "ae1030fc-4b10-41c7-a127-9d81fccfbac0";
    const profile = { ...SAMPLE_PROFILE, id: canonicalId, slug: "my-setup" };
    const m = fakeStorageClient((call) => {
      if (call.path.endsWith(`/profiles/${canonicalId}?limit=20&cursor=0`)) return { status: 404, json: { error: "Profile not found: ae1030" } };
      if (call.path.endsWith(`/profiles/${canonicalId}/assets`)) return { status: 404, json: { error: "Profile not found: ae1030" } };
      if (call.path.endsWith(`/profiles/${canonicalId}/bindings`)) return { status: 404, json: { error: "Profile not found: ae1030" } };
      if (call.path.endsWith(`/profiles/my-setup?limit=20&cursor=0`)) return { json: { profile, configs: page([SAMPLE]) } };
      if (call.path.endsWith(`/profiles/my-setup/assets`)) return { json: { assets: [] } };
      if (call.path.endsWith(`/profiles/my-setup/bindings`)) return { json: { bindings: [] } };
      if (call.path.includes("/profiles?")) return { json: page([profile]) };
      return { status: 404, json: { error: "unexpected request" } };
    });
    const store = new CloudConfigStore(m.client);

    await expect(store.getProfileConfigsPage(canonicalId)).resolves.toMatchObject({ items: [SAMPLE] });
    await expect(store.getProfileAssetBindings(canonicalId)).resolves.toEqual([]);
    await expect(store.getProfileConfigBindings(canonicalId)).resolves.toEqual([]);

    expect(m.calls.map((call) => call.path)).toEqual([
      `/profiles/${canonicalId}?limit=20&cursor=0`,
      "/profiles?limit=100&cursor=0",
      "/profiles/my-setup?limit=20&cursor=0",
      `/profiles/${canonicalId}/assets`,
      "/profiles?limit=100&cursor=0",
      "/profiles/my-setup/assets",
      `/profiles/${canonicalId}/bindings`,
      "/profiles?limit=100&cursor=0",
      "/profiles/my-setup/bindings",
    ]);
  });

  test("profile follow-ups preserve a legacy API's embedded configs when bindings and assets routes are absent", async () => {
    const canonicalId = "ae1030fc-4b10-41c7-a127-9d81fccfbac0";
    const profile = { ...SAMPLE_PROFILE, id: canonicalId, slug: "my-setup", configs: [SAMPLE] };
    const m = fakeStorageClient((call) => {
      if (call.path.endsWith(`/profiles/${canonicalId}`) || call.path.endsWith(`/profiles/${canonicalId}?limit=100&cursor=0`)) {
        return { json: { profile } };
      }
      if (call.path.endsWith(`/profiles/${canonicalId}/bindings`) || call.path.endsWith(`/profiles/${canonicalId}/assets`)) {
        return { status: 404, json: { error: "unknown profile action" } };
      }
      if (call.path.includes("/profiles?")) return { json: page([profile]) };
      return { status: 404, json: { error: "unexpected request" } };
    });
    const store = new CloudConfigStore(m.client);

    await expect(store.getProfileConfigBindings(canonicalId)).resolves.toEqual([
      { profile_id: canonicalId, config_id: SAMPLE.id, sort_order: 0, binding: expect.objectContaining({ activation: { mode: "always" } }) },
    ]);
    await expect(store.getProfileAssetBindings(canonicalId)).resolves.toEqual([]);
  });

  test("legacy follow-up fallback rejects unknown identities for bindings and assets", async () => {
    const m = fakeStorageClient((call) => {
      if (call.path.endsWith("/profiles/missing/bindings") || call.path.endsWith("/profiles/missing/assets")) {
        return { status: 404, json: { error: "unknown profile action" } };
      }
      if (call.path.includes("/profiles?")) return { json: page([{ ...SAMPLE_PROFILE, id: "p1", slug: "present" }]) };
      return { status: 404, json: { error: "Profile not found: missing" } };
    });
    const store = new CloudConfigStore(m.client);

    await expect(store.getProfileConfigBindings("missing")).rejects.toThrow("Profile not found: missing");
    await expect(store.getProfileAssetBindings("missing")).rejects.toThrow("Profile not found: missing");
  });

  test("non-404 malformed follow-up responses do not degrade to an empty legacy result", async () => {
    const m = fakeStorageClient(() => ({ json: { unexpected: true } }));
    const store = new CloudConfigStore(m.client);

    await expect(store.getProfileAssetBindings("profile")).rejects.toThrow(/invalid profile response/);
    await expect(store.getProfileConfigBindings("profile")).rejects.toThrow(/invalid profile response/);
  });

  test("maps profile asset CRUD to the separate cloud API paths", async () => {
    const m = fakeStorageClient((call) => {
      if (call.method === "GET") return { json: { assets: [SAMPLE_ASSET] } };
      if (call.method === "DELETE") return { json: { removed: true } };
      return { status: call.method === "POST" ? 201 : 200, json: { asset: SAMPLE_ASSET } };
    });
    const store = new CloudConfigStore(m.client);

    expect(await store.getProfileAssetBindings("p1")).toEqual([SAMPLE_ASSET]);
    expect(await store.addAssetToProfile("p1", "cfg-1", SAMPLE_ASSET.binding)).toEqual(SAMPLE_ASSET);
    expect(await store.setProfileAssetBinding("p1", "review-skill", SAMPLE_ASSET.binding)).toEqual(SAMPLE_ASSET);
    await store.removeAssetFromProfile("p1", "review-skill");

    expect(m.calls.map((call) => [call.method, call.path])).toEqual([
      ["GET", "/profiles/p1/assets"],
      ["POST", "/profiles/p1/assets"],
      ["PUT", "/profiles/p1/assets/review-skill"],
      ["DELETE", "/profiles/p1/assets/review-skill"],
    ]);
    expect(m.calls[1]?.body).toEqual({ source_config_id: "cfg-1", binding: SAMPLE_ASSET.binding });
    expect(m.calls[2]?.body).toEqual({ binding: SAMPLE_ASSET.binding });
    expect(m.calls[1]?.idempotencyKey).toBeTruthy();
    expect(m.calls[2]?.idempotencyKey).toBeTruthy();
  });

  test("listProfilesPage sends producer bounds and requires complete metadata", async () => {
    const m = fakeStorageClient(() => ({ json: page([SAMPLE_PROFILE], 3, 2, 2) }));
    const store = new CloudConfigStore(m.client);
    const result = await store.listProfilesPage({ limit: 2, cursor: 2 });

    expect(m.calls[0].path).toBe("/profiles?limit=2&cursor=2");
    expect(result).toMatchObject({ total: 3, limit: 2, cursor: 2, complete: true, truncated: false });
  });

  test("getProfileConfigsPage sends membership bounds", async () => {
    const m = fakeStorageClient(() => ({
      json: {
        profile: { ...SAMPLE_PROFILE, configs: [SAMPLE] },
        configs: page([SAMPLE], 5, 2, 4),
      },
    }));
    const store = new CloudConfigStore(m.client);
    const result = await store.getProfileConfigsPage("profile", { limit: 2, cursor: 4 });

    expect(m.calls[0].path).toBe("/profiles/profile?limit=2&cursor=4");
    expect(result).toMatchObject({ total: 5, cursor: 4, complete: true, truncated: false });
  });

  test("resolveProfileForMachineRead sends the source scan bound", async () => {
    const m = fakeStorageClient(() => ({
      json: {
        profile: SAMPLE_PROFILE,
        scanned: 5,
        total: 5,
        batch_limit: 2,
        complete: true,
        truncated: false,
      },
    }));
    const store = new CloudConfigStore(m.client);
    const result = await store.resolveProfileForMachineRead(SAMPLE_MACHINE, { limit: 2 });

    expect(m.calls[0].path).toBe("/profiles/resolve?hostname=station02&os=linux&arch=x64&limit=2");
    expect(result).toMatchObject({ scanned: 5, total: 5, batch_limit: 2, complete: true, truncated: false });
  });

  test("new client sends explicit default bounds and safely pages an old server's complete profile array", async () => {
    const legacyProfiles = Array.from({ length: 5 }, (_, index) => ({
      ...SAMPLE_PROFILE,
      id: `p${index + 1}`,
      name: `Profile ${index + 1}`,
      slug: `profile-${index + 1}`,
    }));
    const m = fakeStorageClient(() => ({ json: { profiles: legacyProfiles, count: legacyProfiles.length } }));
    const store = new CloudConfigStore(m.client);
    const result = await store.listProfilesPage();

    expect(m.calls[0].path).toBe("/profiles?limit=20&cursor=0");
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
    const m = fakeStorageClient(() => ({
      json: { profile: { ...SAMPLE_PROFILE, configs: legacyConfigs } },
    }));
    const store = new CloudConfigStore(m.client);
    const result = await store.getProfileConfigsPage("profile", { limit: 2, cursor: 2 });

    expect(m.calls[0].path).toBe("/profiles/profile?limit=2&cursor=2");
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
    const m = fakeStorageClient(() => ({ json: { profile: SAMPLE_PROFILE } }));
    const store = new CloudConfigStore(m.client);
    const result = await store.resolveProfileForMachineRead(
      { ...SAMPLE_MACHINE, os: null, arch: null },
      { limit: 2 },
    );

    expect(m.calls[0].path).toBe("/profiles/resolve?hostname=station02&limit=2");
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
    const m = fakeStorageClient(() => ({ status: 404, json: { error: "no matching machine-aware profile" } }));
    const store = new CloudConfigStore(m.client);
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
  test("isCloudAuthError only matches the transport's 401/403 HasnaHttpError shape", () => {
    const hasnaError = (status: number) =>
      Object.assign(new Error(`Hasna cloud request failed: GET /configs -> ${status}`), { name: "HasnaHttpError", status });
    expect(isCloudAuthError(hasnaError(401))).toBe(true);
    expect(isCloudAuthError(hasnaError(403))).toBe(true);
    expect(isCloudAuthError(hasnaError(500))).toBe(false);
    expect(isCloudAuthError(hasnaError(404))).toBe(false);
    expect(isCloudAuthError(new Error("network down"))).toBe(false);
  });

  test("formatCliError rewrites a 401 into an actionable re-auth message that never echoes the body", () => {
    const err = Object.assign(
      new Error("Hasna cloud request failed: GET /configs -> 401. The API key in use is revoked."),
      { name: "HasnaHttpError", status: 401 },
    );
    const msg = formatCliError(err);
    expect(msg).toContain("authentication failed");
    expect(msg).toContain("missing, expired, or revoked");
    expect(msg).toContain("export HASNA_INSTRUCTIONS_API_KEY=");
    expect(msg).toContain("export HASNA_INSTRUCTIONS_LOCAL=1");
    // The transport hides the 401/403 body; a rejection can never reflect
    // credential material back into logs through this formatter.
    expect(msg).not.toContain("The API key in use is revoked");
  });

  test("formatCliError leaves non-auth errors as plain messages", () => {
    const err = Object.assign(new Error("Hasna cloud request failed: GET /configs -> 500"), { name: "HasnaHttpError", status: 500 });
    expect(formatCliError(err)).toBe("Hasna cloud request failed: GET /configs -> 500");
    expect(formatCliError(new Error("disk full"))).toBe("disk full");
    expect(formatCliError("raw string")).toBe("raw string");
  });

  test("cloud list path with revoked key surfaces an auth error that formats cleanly", async () => {
    const m = fakeStorageClient(() => ({ status: 401, json: { error: "API key has been revoked" } }));
    const store = new CloudConfigStore(m.client);
    try {
      await store.listConfigs();
      throw new Error("expected listConfigs to reject");
    } catch (err) {
      expect(isCloudAuthError(err)).toBe(true);
      const shown = formatCliError(err);
      expect(shown).toContain("authentication failed");
      expect(shown).toContain("export HASNA_INSTRUCTIONS_LOCAL=1");
      expect(shown).not.toContain("API key has been revoked");
    }
  });

  test("cloud create path with revoked key surfaces an auth error that formats cleanly", async () => {
    const m = fakeStorageClient(() => ({ status: 401, json: { error: "API key has been revoked" } }));
    const store = new CloudConfigStore(m.client);
    try {
      await store.createConfig({ name: "Demo", category: "rules" as never, content: "hello" });
      throw new Error("expected createConfig to reject");
    } catch (err) {
      expect(isCloudAuthError(err)).toBe(true);
      const shown = formatCliError(err);
      expect(shown).toContain("export HASNA_INSTRUCTIONS_API_KEY=");
    }
  });
});

describe("isApiTransport", () => {
  test("true when a hosted credential resolves", () => {
    expect(isApiTransport({ HOME: tempHome("api1"), [API_KEY_ENV]: "k" })).toBe(true);
  });
  test("throws on a refused configuration", () => {
    expect(() => isApiTransport({ HOME: tempHome("api2"), [API_URL_ENV]: "https://x" })).toThrow(/REMOTE_API_KEY_MISSING/);
  });
  test("false for a caller-built env that resolves nothing", () => {
    // A caller-built env is the hermetic seam: no Keychain, no disk, no gate.
    expect(() => isApiTransport({ HOME: tempHome("api3") })).toThrow(/REMOTE_API_CONFIG_MISSING/);
  });
});