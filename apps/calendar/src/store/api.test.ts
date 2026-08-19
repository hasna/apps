import { describe, expect, test } from "bun:test";
import { ApiStore } from "./api.js";
import { createStorageClient, HasnaHttpError, type HttpTransport } from "./http-storage.js";

interface Call { method: string; path: string; body: unknown; query?: Record<string, unknown> }

function apiWith(handler: (method: string, path: string, body: unknown, opts: { query?: Record<string, unknown> }) => Promise<unknown> | unknown): { api: ApiStore; calls: Call[] } {
  const calls: Call[] = [];
  const transport: HttpTransport = {
    baseUrl: "https://calendar.hasna.xyz/v1",
    request: (method, path, body, opts) => {
      calls.push({ method, path, body, query: opts?.query });
      return Promise.resolve(handler(method, path, body, opts ?? {}));
    },
    get: (path, opts) => transport.request("GET", path, undefined, opts),
    post: (path, body, opts) => transport.request("POST", path, body, opts),
    put: (path, body, opts) => transport.request("PUT", path, body, opts),
    patch: (path, body, opts) => transport.request("PATCH", path, body, opts),
    del: (path, body, opts) => transport.request("DELETE", path, body, opts),
  };
  const client = createStorageClient("calendar", transport);
  return { api: new ApiStore(client), calls };
}

const org = { id: "o1", name: "Test", slug: "test" };
const agent = { id: "a1", name: "agent1" };
const calendar = { id: "c1", org_id: "o1", name: "Main", timezone: "UTC", visibility: "org" };
const event = { id: "e1", title: "Standup", calendar_id: "c1", org_id: "o1", start_at: "2026-04-15T09:00:00Z", end_at: "2026-04-15T10:00:00Z" };

describe("ApiStore envelope unwrapping", () => {
  test("listOrgs unwraps the orgs envelope and defaults to [] when absent", async () => {
    const { api, calls } = apiWith(() => ({ orgs: [org] }));
    expect(await api.listOrgs()).toEqual([org]);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/orgs" });
  });

  test("getOrg returns the unwrapped org and null on an empty 200 body", async () => {
    const { api } = apiWith((m, p) => (p === "/orgs/o1" ? { org } : {}));
    expect(await api.getOrg("o1")).toEqual(org);
  });

  test("createOrg unwraps the org envelope and falls back to a bare object", async () => {
    const { api } = apiWith(() => ({ org }));
    expect(await api.createOrg({ name: "Test" })).toEqual(org);
    const { api: bare } = apiWith(() => ({ ...org }));
    expect(await bare.createOrg({ name: "Test" })).toEqual(org);
  });

  test("deleteOrg reads the deleted envelope and defaults to true when absent", async () => {
    const { api } = apiWith(() => ({ deleted: false }));
    expect(await api.deleteOrg("o1")).toBe(false);
    const { api: bare } = apiWith(() => ({}));
    expect(await bare.deleteOrg("o1")).toBe(true);
  });

  test("getEventWithAttendees returns the pair and null when the event is absent", async () => {
    const { api } = apiWith(() => ({ event, attendees: [{ id: "at1", event_id: "e1", status: "needsAction" }] }));
    expect(await api.getEventWithAttendees("e1")).toEqual({ event, attendees: [{ id: "at1", event_id: "e1", status: "needsAction" }] });
    const { api: empty } = apiWith(() => ({}));
    expect(await empty.getEventWithAttendees("e1")).toBeNull();
  });

  test("listEvents forwards the filter as query params, dropping undefined values", async () => {
    const { api, calls } = apiWith(() => ({ events: [event] }));
    await api.listEvents({ calendar_id: "c1", after: "2026-04-15T00:00:00Z", before: undefined });
    expect(calls[0]!.query).toEqual({ calendar_id: "c1", after: "2026-04-15T00:00:00Z" });
  });

  test("createEvent does not send undefined fields in the body", async () => {
    const { api, calls } = apiWith(() => ({ event }));
    await api.createEvent({
      calendar_id: "c1",
      org_id: "o1",
      title: "Standup",
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
      description: undefined,
    });
    expect(calls[0]!.body).toEqual({
      calendar_id: "c1",
      org_id: "o1",
      title: "Standup",
      start_at: "2026-04-15T09:00:00Z",
      end_at: "2026-04-15T10:00:00Z",
    });
  });

  test("heartbeatAgent returns the agent on success and null on 404", async () => {
    const { api } = apiWith(() => ({ agent }));
    expect(await api.heartbeatAgent("a1")).toEqual(agent);

    const { api: missing } = apiWith(() => {
      throw new HasnaHttpError("POST", "/agents/missing/heartbeat", 404, { error: "not found" });
    });
    expect(await missing.heartbeatAgent("missing")).toBeNull();
  });

  test("heartbeatAgent rethrows non-404 errors", async () => {
    const { api } = apiWith(() => {
      throw new HasnaHttpError("POST", "/agents/a1/heartbeat", 500, {});
    });
    await expect(api.heartbeatAgent("a1")).rejects.toThrow(/500/);
  });

  test("getAgent does NOT fall back to a bare object — a missing envelope key is null", async () => {
    // Unlike createOrg/registerAgent (which fall back to the bare payload),
    // getAgent requires the { agent } envelope; absence is null, not the payload.
    const { api } = apiWith(() => ({ ...agent }));
    expect(await api.getAgent("a1")).toBeNull();
  });

  test("upsertAgentAvailability posts to /availability with the raw shape", async () => {
    const { api, calls } = apiWith(() => ({ availability: { id: "av1", agent_id: "a1", org_id: "o1", day_of_week: 1, start_time: "09:00", end_time: "17:00" } }));
    const res = await api.upsertAgentAvailability("a1", "o1", 1, "09:00", "17:00");
    expect(res).toEqual({ id: "av1", agent_id: "a1", org_id: "o1", day_of_week: 1, start_time: "09:00", end_time: "17:00" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/availability" });
  });

  test("findConflicts forwards the range query", async () => {
    const { api, calls } = apiWith(() => ({ conflicts: [event] }));
    const res = await api.findConflicts("c1", { start: "2026-04-15T09:30:00Z", end: "2026-04-15T10:30:00Z" });
    expect(res).toEqual([event]);
    expect(calls[0]!.query).toEqual({ calendar_id: "c1", start: "2026-04-15T09:30:00Z", end: "2026-04-15T10:30:00Z" });
  });

  test("createMembership unwraps the member envelope", async () => {
    const { api } = apiWith(() => ({ member: { id: "m1", org_id: "o1", agent_id: "a1", role: "member" } }));
    expect(await api.createMembership({ org_id: "o1", agent_id: "a1" })).toEqual({ id: "m1", org_id: "o1", agent_id: "a1", role: "member" });
  });

  test("deleteMembershipByAgentAndOrg DELETEs with the query pair", async () => {
    const { api, calls } = apiWith(() => ({ deleted: true }));
    expect(await api.deleteMembershipByAgentAndOrg("a1", "o1")).toBe(true);
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/members", query: { agent_id: "a1", org_id: "o1" } });
  });
});
