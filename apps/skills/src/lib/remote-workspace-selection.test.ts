import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RemoteSkillsClient, RemoteRequestError, RemoteRouteUnsupportedError, RemoteWorkspaceSelectionError } from "./remote-client.js";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { parseAccountWorkspaces, parseWorkspaceSession, workspaceContext, WorkspaceContextInputError, WorkspaceIdentityMismatchError } from "./remote-workspace-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

type Call = { path: string; method: string; body: unknown; auth: string | null; cookie: string | null };
type Override = (req: Request, call: Call) => Response | undefined | Promise<Response | undefined>;
async function fixture(action: (f: ReturnType<typeof setup>) => Promise<void>) {
  const f = setup(); try { await action(f); } finally { await f.server.stop(true); }
}
function setup() {
  const userId = randomUUID(), a = randomUUID(), b = randomUUID(), oa = randomUUID(), ob = randomUUID(), memberId = randomUUID();
  const tokenA = `session-a-${randomUUID()}`, tokenB = `session-b-${randomUUID()}`, ignoredKey = `sk_${randomUUID()}`;
  const organizationA = { id: oa, slug: "original", name: "Original" }, organizationB = { id: ob, slug: "selected", name: "Selected" };
  const user = { id: userId, membershipId: a, email: "owner@example.test", displayName: null, role: "owner" as const };
  const selected = { token: tokenB, user: { ...user, membershipId: b }, organization: organizationB };
  const listing = { workspaces: [{ membershipId: a, organization: organizationA, role: "owner" as const, current: true },
    { membershipId: b, organization: organizationB, role: "viewer" as const, current: false }] };
  const member = { membershipId: memberId, userId: randomUUID(), email: "member@example.test", displayName: null,
    role: "viewer", createdAt: "2026-09-07T00:00:00.123456Z" };
  const calls: Call[] = [];
  let override: Override | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname + new URL(req.url).search;
    const body = req.method === "GET" ? undefined : await req.json().catch(() => undefined);
    const call = { path, method: req.method, body, auth: req.headers.get("authorization"), cookie: req.headers.get("cookie") };
    calls.push(call);
    const custom = await override?.(req, call); if (custom) return custom;
    const selectedAuth = call.auth === `Bearer ${tokenB}`;
    if (path.endsWith("/api/auth/verify")) return Response.json({ token: tokenA, apiKey: ignoredKey, user, organization: organizationA });
    if (path.endsWith("/api/auth/whoami")) return Response.json({ user: selectedAuth ? selected.user : user,
      organization: selectedAuth ? organizationB : organizationA, authMethod: "jwt" });
    if (path.endsWith("/account/workspaces")) return Response.json(listing);
    if (path.endsWith("/account/workspaces/switch")) return Response.json(selected);
    // A default-token operation cannot accidentally make the selected-workspace test pass.
    if (!selectedAuth) return Response.json({ error: "wrong-workspace" }, { status: 403 });
    if (path.endsWith("/account/profile")) return Response.json({ user: { ...selected.user, displayName: (body as any).displayName } });
    if (path.endsWith("/workspaces/current")) return Response.json({ organization: { ...organizationB, name: (body as any).name } });
    if (path.includes("/workspace/members?")) return Response.json({ organizationId: ob, members: [member], nextCursor: null });
    if (path.endsWith(`/workspace/members/${memberId}`)) return Response.json(req.method === "PATCH"
      ? { organizationId: ob, member, changed: true }
      : { organizationId: ob, membershipId: memberId, removed: true, alreadyRemoved: false });
    if (path.endsWith("/api/auth/keys")) return Response.json(req.method === "POST" ? { key: ignoredKey } : []);
    if (path.endsWith("/api/auth/keys/selected-key")) return Response.json({ revoked: true });
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  } });
  const origin = `${server.url.origin}/prefix/api/v1`;
  return { server, origin, userId, a, b, oa, ob, memberId, user, selected, listing, tokenA, tokenB, ignoredKey, calls,
    context: { userId, membershipId: b }, fresh: new RemoteSkillsAuthClient(origin), client: new RemoteSkillsClient(tokenA, origin),
    override(value?: Override) { override = value; } };
}
const email = "owner@example.test", code = "123456";

test("workspace projections reject ambiguous listings and target confusion without exposing extra fields", async () => fixture(async f => {
  expect(parseAccountWorkspaces({ ...f.listing, token: f.ignoredKey })).toEqual(f.listing);
  expect(parseWorkspaceSession({ ...f.selected, apiKey: f.ignoredKey, user: { ...f.selected.user, private: f.ignoredKey } }, f.context)).toEqual(f.selected);
  for (const value of [null, [], {}, { workspaces: [] }, { workspaces: [...f.listing.workspaces, f.listing.workspaces[0]] },
    { workspaces: f.listing.workspaces.map(w => ({ ...w, current: false })) },
    { workspaces: f.listing.workspaces.map(w => ({ ...w, current: true })) },
    { workspaces: [{ ...f.listing.workspaces[0], role: "superuser" }] },
    { workspaces: [{ ...f.listing.workspaces[0], organization: { id: f.oa, slug: "bad\nslug", name: "name" } }] },
    { workspaces: [f.listing.workspaces[0], { ...f.listing.workspaces[1], organization: f.listing.workspaces[0]!.organization }] }])
    expect(() => parseAccountWorkspaces(value)).toThrow();
  for (const value of [{ ...f.selected, token: f.ignoredKey }, { ...f.selected, token: "token\nvalue" }, { ...f.selected, token: "x".repeat(8193) },
    { ...f.selected, user: { ...f.selected.user, membershipId: f.a } }, { ...f.selected, user: { ...f.selected.user, id: randomUUID() } }])
    expect(() => parseWorkspaceSession(value, f.context)).toThrow();
  expect(f.calls).toEqual([]);
}));

test("SDK and fresh discovery/select use exact bearer routes and never issue keys or mutate the source client", async () => fixture(async f => {
  expect(await f.client.listAccountWorkspaces()).toEqual(f.listing);
  expect(await f.fresh.listAccountWorkspaces(email, code)).toEqual({ userId: f.userId, ...f.listing });
  expect(await f.client.switchWorkspace(f.context)).toEqual(f.selected);
  expect(await f.fresh.switchWorkspace(email, code, f.context)).toEqual(f.selected);
  expect((await f.client.getIdentity()).organization).toEqual(f.listing.workspaces[0]!.organization);
  expect(f.calls.filter(c => c.path.endsWith("/switch")).map(c => c.body)).toEqual([{ membershipId: f.b }, { membershipId: f.b }]);
  expect(f.calls.filter(c => c.path.endsWith("/switch")).every(c => c.auth === `Bearer ${f.tokenA}`)).toBe(true);
  expect(f.calls.every(c => c.cookie === null && c.auth !== `Bearer ${f.ignoredKey}`)).toBe(true);
  expect(f.calls.some(c => c.path.includes("/keys"))).toBe(false);
}));

test("all fresh-auth mutations and reads preserve selected B after OTP selects default A", async () => fixture(async f => {
  const auth = f.fresh, ctx = f.context;
  expect((await auth.updateProfile(email, code, { displayName: "Selected name" }, ctx)).user.id).toBe(f.userId);
  expect((await auth.updateCurrentWorkspace(email, code, { name: "Selected title" }, ctx)).organization.id).toBe(f.ob);
  expect((await auth.listWorkspaceMembers(email, code, { limit: 1 }, ctx)).organizationId).toBe(f.ob);
  expect((await auth.setWorkspaceMemberRole(email, code, f.memberId, { role: "viewer", expectedRole: "member" }, ctx)).organizationId).toBe(f.ob);
  expect((await auth.removeWorkspaceMember(email, code, f.memberId, { expectedRole: "viewer" }, ctx)).organizationId).toBe(f.ob);
  expect(await auth.listApiKeys(email, code, ctx)).toEqual([]);
  expect(await auth.createApiKey(email, code, "explicit selected key", ["skills:read"], ctx)).toEqual({ key: f.ignoredKey });
  expect(await auth.revokeApiKey(email, code, "selected-key", ctx)).toEqual({ revoked: true });
  const domain = f.calls.filter(c => !["/verify", "/whoami", "/switch"].some(p => c.path.endsWith(p)));
  expect(domain).toHaveLength(8); expect(domain.every(c => c.auth === `Bearer ${f.tokenB}`)).toBe(true);
  expect(f.calls.filter(c => c.path.endsWith("/keys") && c.method === "POST")).toHaveLength(1);
}));

test("invalid contexts refuse before OTP; wrong users and API-key authority refuse before selection or mutation", async () => fixture(async f => {
  for (const ctx of [null, [], {}, { userId: f.userId }, { membershipId: f.b }, { ...f.context, userId: "other" },
    { ...f.context, membershipId: f.b.toUpperCase() }, { ...f.context, organizationId: f.ob }]) {
    expect(() => workspaceContext(ctx)).toThrow(WorkspaceContextInputError);
    await expect(f.fresh.updateCurrentWorkspace(email, code, { name: "Never" }, ctx as never)).rejects.toBeInstanceOf(WorkspaceContextInputError);
    await expect(f.client.switchWorkspace(ctx as never)).rejects.toBeInstanceOf(WorkspaceContextInputError);
  }
  await expect(f.fresh.listAccountWorkspaces(email, code, "invalid")).rejects.toBeInstanceOf(WorkspaceContextInputError);
  expect(f.calls).toEqual([]);
  await expect(f.fresh.updateCurrentWorkspace(email, code, { name: "Never" }, { ...f.context, userId: randomUUID() })).rejects.toBeInstanceOf(WorkspaceIdentityMismatchError);
  expect(f.calls).toHaveLength(1); expect(f.calls[0]?.path.endsWith("/verify")).toBe(true);
  f.override((_req, c) => c.path.endsWith("/whoami") ? Response.json({ user: f.user, organization: f.selected.organization, authMethod: "api_key" }) : undefined);
  await expect(f.fresh.createApiKey(email, code, "Never", [], f.context)).rejects.toBeInstanceOf(RemoteWorkspaceSelectionError);
  expect(f.calls.some(c => c.path.endsWith("/switch") || c.path.endsWith("/keys"))).toBe(false);
}));

test("mismatched selected identity or malformed success never reaches the requested mutation", async () => fixture(async f => {
  for (const result of [{}, { ...f.selected, user: { ...f.selected.user, id: randomUUID() } },
    { ...f.selected, user: { ...f.selected.user, membershipId: f.a } }, { ...f.selected, token: f.ignoredKey }, { ...f.selected, token: f.tokenA }]) {
    f.override((_req, c) => c.path.endsWith("/switch") ? Response.json(result) : undefined);
    await expect(f.fresh.updateCurrentWorkspace(email, code, { name: "Never" }, f.context)).rejects.toThrow();
  }
  expect(f.calls.filter(c => c.path.endsWith("/workspaces/current"))).toEqual([]);
}));

test("context, name, scopes, pagination and origin are captured before verification awaits", async () => {
  let forwarded = 0;
  const trap = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { forwarded++; return Response.json({}); } });
  try { for (const operation of ["name", "keys", "roster"] as const) await fixture(async f => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => { release = r; }), seen = new Promise<void>(r => { entered = r; });
    f.override(async (_req, c) => { if (c.path.endsWith("/verify")) { entered(); await gate; } return undefined; });
    const ctx = { ...f.context }, input = { name: "Original target name" }, scopes = ["skills:read"], page = { limit: 1 };
    const pending = operation === "name" ? f.fresh.updateCurrentWorkspace(email, code, input, ctx)
      : operation === "keys" ? f.fresh.createApiKey(email, code, "key", scopes, ctx) : f.fresh.listWorkspaceMembers(email, code, page, ctx);
    await seen; ctx.userId = randomUUID(); ctx.membershipId = f.a; input.name = "Changed"; scopes.push("runs:write"); page.limit = 99;
    (f.fresh as unknown as { apiOrigin: string }).apiOrigin = trap.url.origin; release(); await pending;
    expect(f.calls.find(c => c.path.endsWith("/switch"))?.body).toEqual({ membershipId: f.b });
    const last = f.calls.at(-1)!; expect(last.auth).toBe(`Bearer ${f.tokenB}`);
    if (operation === "name") expect(last.body).toEqual({ name: "Original target name" });
    if (operation === "keys") expect(last.body).toEqual({ name: "key", scopes: ["skills:read"] });
    if (operation === "roster") expect(last.path.endsWith("?limit=1")).toBe(true);
  }); } finally { await trap.stop(true); }
  expect(forwarded).toBe(0);
});

test("workspace refusal codes are fixed, exact-status checked and distinct from unsupported routes", async () => fixture(async f => {
  for (const [status, code] of [[400, "INVALID_WORKSPACE_SELECTION"], [401, "SESSION_EXPIRED"], [403, "ACCOUNT_UNAVAILABLE"],
    [403, "INTERACTIVE_SESSION_REQUIRED"], [404, "WORKSPACE_UNAVAILABLE"], [503, "WORKSPACE_BUSY"]] as const) {
    f.override((_req, c) => c.path.endsWith("/switch") ? Response.json({ code, error: f.ignoredKey }, { status }) : undefined);
    const before = f.calls.length, error = await f.client.switchWorkspace(f.context).catch(e => e);
    expect(error).toBeInstanceOf(RemoteWorkspaceSelectionError); expect(error.code).toBe(code); expect(error.status).toBe(status);
    expect(error.message).not.toContain(f.ignoredKey); expect(f.calls.length - before).toBe(2);
  }
  for (const status of [401, 403, 404, 405, 500, 503]) {
    f.override(() => Response.json({ code: "unknown", error: f.ignoredKey }, { status }));
    const error = await f.client.listAccountWorkspaces().catch(e => e);
    expect(error).toBeInstanceOf(status === 404 || status === 405 ? RemoteRouteUnsupportedError : RemoteRequestError);
    expect(error.message).not.toContain(f.ignoredKey);
  }
  f.override(() => Response.json({ code: "WORKSPACE_UNAVAILABLE" }, { status: 500 }));
  await expect(f.client.listAccountWorkspaces()).rejects.not.toBeInstanceOf(RemoteWorkspaceSelectionError);
}));

test("redirects and oversized replies refuse without forwarding or exposing secrets", async () => {
  let forwarded = 0;
  const trap = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { forwarded++; return Response.json({}); } });
  try { await fixture(async f => {
    for (const stage of ["verify", "switch"] as const) {
      f.override((_req, c) => c.path.endsWith(`/${stage}`) ? new Response(null, { status: 307, headers: { location: trap.url.href } }) : undefined);
      await expect(f.fresh.updateCurrentWorkspace(email, code, { name: "Never" }, f.context)).rejects.toThrow();
    }
    f.override(() => new Response("x".repeat(1024 * 1024 + 1)));
    await expect(f.client.listAccountWorkspaces()).rejects.toThrow("invalid workspace selection");
    for (const status of [400, 401, 403, 500]) {
      f.override(() => Response.json({ error: f.ignoredKey, code: f.tokenA }, { status }));
      const error = await f.fresh.switchWorkspace(email, code, f.context).catch(e => e);
      expect(error.message).not.toContain(f.ignoredKey); expect(JSON.stringify(error)).not.toContain(f.tokenA);
    }
    expect(f.calls.some(c => c.path.endsWith("/workspaces/current"))).toBe(false);
  }); } finally { await trap.stop(true); }
  expect(forwarded).toBe(0);
});

test("bearer SDK requests omit browser credentials; token lifetime remains server-owned", async () => fixture(async f => {
  const original = globalThis.fetch, requests: RequestInit[] = [];
  globalThis.fetch = ((url: Parameters<typeof fetch>[0], init?: RequestInit) => { requests.push(init ?? {}); return original(url, init); }) as typeof fetch;
  try {
    const jwt = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ iat: 1, exp: 2, mid: f.b })).toString('base64url')}.signature`;
    f.override((_req, c) => c.path.endsWith("/switch") ? Response.json({ ...f.selected, token: jwt })
      : c.path.endsWith("/whoami") && c.auth === `Bearer ${jwt}` ? Response.json({ ...f.selected, authMethod: "jwt" }) : undefined);
    expect((await f.fresh.switchWorkspace(email, code, f.context)).token).toBe(jwt);
    expect(requests).toHaveLength(4); expect(requests.every(r => r.credentials === "omit" && r.redirect === "error")).toBe(true);
  } finally { globalThis.fetch = original; }
}));

test("fresh discovery binds the actual token identity and current membership before returning a list", async () => fixture(async f => {
  f.override((_req, c) => c.path.endsWith("/whoami") ? Response.json({ user: { ...f.user, id: randomUUID() }, organization: f.selected.organization, authMethod: "jwt" }) : undefined);
  await expect(f.fresh.listAccountWorkspaces(email, code, f.userId)).rejects.toBeInstanceOf(WorkspaceIdentityMismatchError);
  expect(f.calls.some(c => c.path.endsWith("/account/workspaces"))).toBe(false);
  f.override((_req, c) => c.path.endsWith("/account/workspaces") ? Response.json({ workspaces: f.listing.workspaces.map(w => ({ ...w, current: !w.current })) }) : undefined);
  await expect(f.fresh.listAccountWorkspaces(email, code)).rejects.toBeInstanceOf(WorkspaceIdentityMismatchError);
  expect(f.calls.some(c => c.method !== "GET" && !c.path.endsWith("/verify"))).toBe(false);
}));

test("viewer selection remains possible while key and support refusals stay server-owned", async () => fixture(async f => {
  let support = false;
  f.override((_req, c) => {
    if (c.path.endsWith("/switch")) return support ? Response.json({ error: f.ignoredKey }, { status: 403 })
      : Response.json({ ...f.selected, user: { ...f.selected.user, role: "viewer" } });
    if (c.path.endsWith("/whoami") && c.auth === `Bearer ${f.tokenB}`) return Response.json({ ...f.selected, user: { ...f.selected.user, role: "viewer" }, authMethod: "jwt" });
    if (c.path.endsWith("/keys")) return Response.json({ error: f.ignoredKey }, { status: 403 });
    return undefined;
  });
  expect((await f.fresh.switchWorkspace(email, code, f.context)).user.role).toBe("viewer");
  await expect(f.fresh.createApiKey(email, code, "Refused viewer key", [], f.context)).rejects.toBeInstanceOf(RemoteRequestError);
  support = true; const before = f.calls.length;
  await expect(f.fresh.updateCurrentWorkspace(email, code, { name: "Never" }, f.context)).rejects.toBeInstanceOf(RemoteRequestError);
  expect(f.calls.slice(before).some(c => c.path.endsWith("/workspaces/current"))).toBe(false);
}));
