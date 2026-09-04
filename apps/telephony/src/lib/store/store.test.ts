import { afterEach, describe, expect, it } from "bun:test";
import {
  getStore,
  isCloudStore,
  isLocalModeOptIn,
  resetStore,
  telephonyStoreMisconfiguredError,
  ApiStore,
  LocalStore,
} from "./index.js";
import { HasnaHttpError } from "@hasna/contracts";
import type { Agent, AgentConflictError, Call } from "../../types/index.js";

const CLIENT_ENV = [
  "HASNA_TELEPHONY_STORAGE_MODE",
  "HASNA_TELEPHONY_MODE",
  "TELEPHONY_STORAGE_MODE",
  "TELEPHONY_MODE",
  "HASNA_TELEPHONY_API_URL",
  "HASNA_TELEPHONY_API_KEY",
  "TELEPHONY_API_URL",
  "TELEPHONY_API_KEY",
  "HASNA_TELEPHONY_LOCAL",
  "TELEPHONY_LOCAL",
];

function clearEnv(): void {
  for (const k of CLIENT_ENV) delete process.env[k];
  resetStore();
}

afterEach(clearEnv);

describe("telephony Store resolver", () => {
  // Fail-closed contract (owner directive 2026-09-04): a missing API env is
  // NEVER a silent selection of the on-box SQLite store. Local mode is
  // reachable only through the explicit HASNA_TELEPHONY_LOCAL=1 opt-in; with
  // no API env and no opt-in, resolution throws an actionable error naming the
  // required variables.
  it("fails closed when nothing is set — never defaults to the LocalStore", () => {
    clearEnv();
    expect(() => getStore()).toThrow(/HASNA_TELEPHONY_API_URL/);
    expect(() => getStore()).toThrow(/HASNA_TELEPHONY_API_KEY/);
    // The error names the explicit local opt-in instead of offering a silent
    // fallback; nothing about it reads as a false-green local event.
    expect(() => getStore()).toThrow(/HASNA_TELEPHONY_LOCAL=1/);
    expect(() => isCloudStore()).toThrow();
    expect(telephonyStoreMisconfiguredError().message).toMatch(/fails closed instead of silently serving the local SQLite store/);
  });

  it("selects the LocalStore ONLY under the explicit opt-in HASNA_TELEPHONY_LOCAL=1", () => {
    clearEnv();
    const env = { HASNA_TELEPHONY_LOCAL: "1" } as Record<string, string>;
    const store = getStore(env);
    expect(store.transport).toBe("local");
    expect(store).toBeInstanceOf(LocalStore);
    expect(isLocalModeOptIn(env)).toBe(true);
    expect(isCloudStore(env)).toBe(false);
  });

  it("accepts the unprefixed TELEPHONY_LOCAL alias as the explicit opt-in", () => {
    clearEnv();
    const env = { TELEPHONY_LOCAL: "1" } as Record<string, string>;
    expect(getStore(env).transport).toBe("local");
    expect(isLocalModeOptIn(env)).toBe(true);
  });

  it("treats falsy opt-in spellings (0, false, no, off, blank) as absent — local mode stays closed", () => {
    clearEnv();
    for (const value of ["0", "false", "no", "off", ""]) {
      const env = { HASNA_TELEPHONY_LOCAL: value } as Record<string, string>;
      expect(isLocalModeOptIn(env)).toBe(false);
      expect(() => getStore(env)).toThrow(/HASNA_TELEPHONY_API_URL/);
    }
  });

  it("treats truthy opt-in spellings (1, true, yes) as opting in to local mode", () => {
    clearEnv();
    for (const value of ["1", "true", "yes", " 1 "]) {
      const env = { HASNA_TELEPHONY_LOCAL: value } as Record<string, string>;
      expect(isLocalModeOptIn(env)).toBe(true);
      expect(getStore(env).transport).toBe("local");
    }
  });

  it("routes to the ApiStore when both API URL and API key are set", () => {
    clearEnv();
    const env = {
      HASNA_TELEPHONY_API_URL: "https://telephony.invalid",
      HASNA_TELEPHONY_API_KEY: "hasna_telephony_test_key",
    } as Record<string, string>;
    const store = getStore(env);
    expect(store.transport).toBe("cloud-http");
    expect(store).toBeInstanceOf(ApiStore);
    expect(isCloudStore(env)).toBe(true);
  });

  it("routes to the ApiStore when the alias API pair is set", () => {
    clearEnv();
    const env = {
      TELEPHONY_API_URL: "https://telephony.invalid",
      TELEPHONY_API_KEY: "hasna_telephony_test_key",
    } as Record<string, string>;
    expect(getStore(env).transport).toBe("cloud-http");
  });

  it("throws naming the missing variable when exactly one side of the API pair is set", () => {
    clearEnv();
    const missingKey = {
      HASNA_TELEPHONY_API_URL: "https://telephony.invalid",
    } as Record<string, string>;
    expect(() => getStore(missingKey)).toThrow(/HASNA_TELEPHONY_API_KEY/);
    const missingUrl = {
      HASNA_TELEPHONY_API_KEY: "hasna_telephony_test_key",
    } as Record<string, string>;
    expect(() => getStore(missingUrl)).toThrow(/HASNA_TELEPHONY_API_URL/);
  });

  it("throws naming the retired variable when a storage-mode variable is still set", () => {
    clearEnv();
    for (const key of ["HASNA_TELEPHONY_STORAGE_MODE", "HASNA_TELEPHONY_MODE", "TELEPHONY_STORAGE_MODE", "TELEPHONY_MODE"]) {
      const env = { [key]: "postgres" } as Record<string, string>;
      expect(() => getStore(env)).toThrow(new RegExp(key));
    }
  });

  it("throws on a retired storage-mode variable even when it looks redundant with a full API pair", () => {
    clearEnv();
    const env = {
      HASNA_TELEPHONY_STORAGE_MODE: "postgres",
      HASNA_TELEPHONY_API_URL: "https://telephony.invalid",
      HASNA_TELEPHONY_API_KEY: "hasna_telephony_test_key",
    } as Record<string, string>;
    // The ratchet names the retired var; it is never a hint, so the pair does
    // not rescue the config.
    expect(() => getStore(env)).toThrow(/HASNA_TELEPHONY_STORAGE_MODE/);
  });

  // The bug this file's suite exists to keep closed: hasna.contract.json
  // advertises the sqlite|postgresql data-backend switch, and the removed
  // placement vocabulary must never come back as a transport selector. The
  // client accepts no mode word at all — transport is the API pair — so any
  // placement word set as a storage-mode variable is rejected by the ratchet.
  it("rejects the removed placement vocabulary the manifest no longer declares", () => {
    clearEnv();
    for (const removed of ["local", "cloud", "self_hosted", "remote", "hybrid"]) {
      const env = {
        HASNA_TELEPHONY_STORAGE_MODE: removed,
        HASNA_TELEPHONY_API_URL: "https://telephony.invalid",
        HASNA_TELEPHONY_API_KEY: "hasna_telephony_test_key",
      } as Record<string, string>;
      expect(() => getStore(env)).toThrow(/HASNA_TELEPHONY_STORAGE_MODE was removed/);
    }
  });
});

describe("ApiStore cloud filters (parity with LocalStore)", () => {
  // A capturing HasnaStorageClient stub that records the query passed to list().
  function captureClient() {
    const calls: { resource: string; query?: Record<string, unknown> }[] = [];
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.invalid/v1",
      transport: {} as never,
      async list(resource: string, options?: { query?: Record<string, unknown> }) {
        calls.push({ resource, query: options?.query });
        return { items: [], total: 0, cursor: null, raw: {} };
      },
      async get() {
        return null;
      },
      async create() {
        return {} as never;
      },
      async update() {
        return {} as never;
      },
      async delete() {},
    };
    return { client, calls };
  }

  it("sends the listened filter to /v1/voicemails (--unheard not dropped)", async () => {
    const { client, calls } = captureClient();
    const store = new ApiStore(client as never);
    await store.listVoicemails({ listened: false });
    const call = calls.find((c) => c.resource === "voicemails")!;
    expect(call.query).toEqual({ listened: "false" });
  });

  it("omits listened when the filter is undefined (tri-state)", async () => {
    const { client, calls } = captureClient();
    const store = new ApiStore(client as never);
    await store.listVoicemails({ agent_id: "a1" });
    const call = calls.find((c) => c.resource === "voicemails")!;
    expect(call.query).toEqual({ agent_id: "a1" });
  });

  it("sends agent_id/project_id/enabled to /v1/schedules (filters not dropped)", async () => {
    const { client, calls } = captureClient();
    const store = new ApiStore(client as never);
    await store.listSchedules({ agent_id: "a1", project_id: "p1", enabled: true });
    const call = calls.find((c) => c.resource === "schedules")!;
    // listAll drops undefined keys; enabled must be present as "true".
    expect(call.query).toMatchObject({ agent_id: "a1", project_id: "p1", enabled: "true" });
  });

  it("forwards project_id to /v1/agents when listing (filter not dropped)", async () => {
    const { client, calls } = captureClient();
    const store = new ApiStore(client as never);
    await store.listAgents("p1");
    const call = calls.find((c) => c.resource === "agents")!;
    expect(call.query).toEqual({ project_id: "p1" });
  });
});

describe("ApiStore Twilio passthrough routes through the server /v1 proxy", () => {
  // Capture transport.get() calls — the escape hatch ApiStore uses for the
  // non-CRUD Twilio-proxy routes. The client must NEVER call Twilio directly.
  function captureTransport(items: unknown[]) {
    const calls: { path: string; query?: Record<string, unknown> }[] = [];
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.invalid/v1",
      transport: {
        baseUrl: "https://telephony.invalid/v1",
        async get(path: string, opts?: { query?: Record<string, unknown> }) {
          calls.push({ path, query: opts?.query });
          return { items, total: items.length };
        },
        async request() { return {} as never; },
        async post() { return {} as never; },
        async put() { return {} as never; },
        async patch() { return {} as never; },
        async del() { return {} as never; },
      },
      async list() { return { items: [], total: 0, cursor: null, raw: {} }; },
      async get() { return null; },
      async create() { return {} as never; },
      async update() { return {} as never; },
      async delete() {},
    };
    return { client, calls };
  }

  it("searchAvailableNumbers → GET /numbers/available with mapped query", async () => {
    const sample = [{ phoneNumber: "+15005550006", friendlyName: "(500) 555-0006", locality: "X", region: "CA", capabilities: { voice: true, sms: true, mms: false } }];
    const { client, calls } = captureTransport(sample);
    const store = new ApiStore(client as never);
    const res = await store.searchAvailableNumbers({ country: "US", area_code: "415", limit: 5, sms_enabled: true });
    expect(calls[0]!.path).toBe("/numbers/available");
    expect(calls[0]!.query).toEqual({ country: "US", area_code: "415", sms_enabled: "true", limit: 5 });
    expect(res).toEqual(sample);
  });

  it("listTwilioNumbers → GET /numbers/twilio", async () => {
    const sample = [{ sid: "PNxxx", phoneNumber: "+15005550006", friendlyName: "main" }];
    const { client, calls } = captureTransport(sample);
    const store = new ApiStore(client as never);
    const res = await store.listTwilioNumbers();
    expect(calls[0]!.path).toBe("/numbers/twilio");
    expect(res).toEqual(sample);
  });

  it("listVoices → GET /voices (client never calls ElevenLabs directly / needs no local key)", async () => {
    const sample = [{ voice_id: "v1", name: "Rachel", category: "premade", description: "" }];
    const { client, calls } = captureTransport(sample);
    const store = new ApiStore(client as never);
    const res = await store.listVoices();
    expect(calls[0]!.path).toBe("/voices");
    expect(res).toEqual(sample);
  });
});

describe("ApiStore.registerAgent (parity with LocalStore conflict semantics)", () => {
  const existing: Agent = {
    id: "ag-1",
    name: "brutus",
    description: null,
    session_id: "sess-A",
    project_id: null,
    capabilities: [],
    permissions: ["*"],
    status: "active",
    metadata: {},
    last_seen_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it("maps a 409 from the serve route to an AgentConflictError value (not a throw)", async () => {
    const conflict: AgentConflictError = {
      error: "conflict",
      message: `Agent name "brutus" is currently held by an active session`,
      existing_agent: existing,
    };
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.invalid/v1",
      transport: {} as never,
      async list() { return { items: [], total: 0, cursor: null, raw: {} }; },
      async get() { return null; },
      async create() {
        throw new HasnaHttpError("POST", "/agents", 409, conflict);
      },
      async update() { return {} as never; },
      async delete() {},
    };
    const store = new ApiStore(client as never);
    const result = await store.registerAgent({ name: "Brutus", session_id: "sess-B" });
    expect("error" in result && result.error).toBe("conflict");
    expect((result as AgentConflictError).existing_agent.id).toBe("ag-1");
  });

  it("re-throws non-409 HTTP errors (does not swallow real failures)", async () => {
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.invalid/v1",
      transport: {} as never,
      async list() { return { items: [], total: 0, cursor: null, raw: {} }; },
      async get() { return null; },
      async create() {
        throw new HasnaHttpError("POST", "/agents", 500, { error: "internal" });
      },
      async update() { return {} as never; },
      async delete() {},
    };
    const store = new ApiStore(client as never);
    await expect(store.registerAgent({ name: "Brutus" })).rejects.toThrow();
  });

  it("matches agents by name case-insensitively (getAgentByName parity)", async () => {
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.invalid/v1",
      transport: {} as never,
      async list() { return { items: [existing], total: 1, cursor: null, raw: {} }; },
      async get() { return null; },
      async create() { return {} as never; },
      async update() { return {} as never; },
      async delete() {},
    };
    const store = new ApiStore(client as never);
    const found = await store.getAgentByName("BRUTUS");
    expect(found?.id).toBe("ag-1");
  });
});

describe("ApiStore media-copy routes (parity with LocalStore)", () => {
  // A capturing HasnaStorageClient stub that records list + update calls: the
  // media-copy routes must find the call row by twilio_sid DB-side and attach
  // copy metadata via the /v1 PATCH routes the hosted PG backend serves — the
  // review fix for the recording webhook writing on-box SQLite directly.
  function captureMediaClient(itemsForCalls: unknown[]) {
    const calls: { resource: string; query?: Record<string, unknown> }[] = [];
    const updates: { resource: string; id: string; body: Record<string, unknown> }[] = [];
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.invalid/v1",
      transport: {} as never,
      async list(resource: string, options?: { query?: Record<string, unknown> }) {
        calls.push({ resource, query: options?.query });
        if (resource === "calls") return { items: itemsForCalls, total: itemsForCalls.length, cursor: null, raw: {} };
        return { items: [], total: 0, cursor: null, raw: {} };
      },
      async get() {
        return null;
      },
      async create() {
        return {} as never;
      },
      async update(resource: string, id: string, body: Record<string, unknown>) {
        updates.push({ resource, id, body });
        return {};
      },
      async delete() {},
    };
    return { client, calls, updates };
  }

  const callRow: Call = {
    id: "call-1",
    direction: "inbound",
    from_number: "+15551234567",
    to_number: "+15559876543",
    status: "in-progress",
    duration: null,
    recording_url: null,
    object_key: null,
    sha256: null,
    transcription: null,
    agent_id: null,
    project_id: null,
    twilio_sid: "CAmedia1",
    metadata: {},
    started_at: "2026-09-04T00:00:00.000Z",
    ended_at: null,
    created_at: "2026-09-04T00:00:00.000Z",
  };

  it("getCallByTwilioSid sends the exact twilio_sid filter to /v1/calls and returns the row", async () => {
    const { client, calls } = captureMediaClient([callRow]);
    const store = new ApiStore(client as never);
    const found = await store.getCallByTwilioSid("CAmedia1");
    const list = calls.find((c) => c.resource === "calls")!;
    expect(list.query).toEqual({ twilio_sid: "CAmedia1" });
    expect(found?.id).toBe("call-1");
  });

  it("getCallByTwilioSid returns null for a CallSid no call row matches", async () => {
    const { client, calls } = captureMediaClient([]);
    const store = new ApiStore(client as never);
    const found = await store.getCallByTwilioSid("CAghost");
    const list = calls.find((c) => c.resource === "calls")!;
    expect(list.query).toEqual({ twilio_sid: "CAghost" });
    expect(found).toBeNull();
  });

  it("updateMessageMedia PATCHes object_key/sha256 onto /v1/messages/<id>", async () => {
    const { client, updates } = captureMediaClient([]);
    const store = new ApiStore(client as never);
    const media = { object_key: "telephony/media/SM1/abc.mp3", sha256: "abc" };
    await store.updateMessageMedia("msg-1", media);
    expect(updates).toEqual([{ resource: "messages", id: "msg-1", body: media }]);
  });

  it("updateVoicemailMedia PATCHes object_key/sha256 onto /v1/voicemails/<id>", async () => {
    const { client, updates } = captureMediaClient([]);
    const store = new ApiStore(client as never);
    const media = { object_key: "telephony/media/vm1/def.mp3", sha256: "def" };
    await store.updateVoicemailMedia("vm-1", media);
    expect(updates).toEqual([{ resource: "voicemails", id: "vm-1", body: media }]);
  });
});
