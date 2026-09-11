import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RemoteSkillsClient } from "./remote-client.js";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { RemoteWorkspaceLeaveError, RemoteWorkspaceLeaveUnconfirmedError } from "./remote-workspace-leave.js";
import { WorkspaceIdentityMismatchError } from "./remote-workspace-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

type Call = { path: string; method: string; body: unknown; auth: string | null; cookie: string | null };
type Override = (req: Request, call: Call) => Response | undefined | Promise<Response | undefined>;
async function fixture(action: (f: ReturnType<typeof setup>) => Promise<void>) {
  const f = setup(); try { await action(f); } finally { await f.server.stop(true); }
}
function setup() {
  const userId = randomUUID(), a = randomUUID(), b = randomUUID(), oa = randomUUID(), ob = randomUUID();
  const tokenA = `session-a-${randomUUID()}`, tokenB = `session-b-${randomUUID()}`, ignoredKey = `sk_${randomUUID()}`;
  const organizationA = { id: oa, slug: "original", name: "Original" }, organizationB = { id: ob, slug: "selected", name: "Selected" };
  const user = { id: userId, membershipId: a, email: "owner@example.test", displayName: null, role: "owner" as const };
  const selected = { token: tokenB, user: { ...user, membershipId: b, role: "viewer" as const }, organization: organizationB };
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
    if (path.endsWith("/account/workspaces/switch")) return Response.json(selected);
    // A default-token operation cannot accidentally make the selected-workspace test pass.
    if (!selectedAuth) return Response.json({ error: "wrong-workspace" }, { status: 403 });
    if (path.endsWith("/account/workspaces/leave")) return Response.json({ organizationId: ob, membershipId: b, removed: true, signInRequired: true });
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  } });
  const origin = `${server.url.origin}/prefix/api/v1`;
  return { server, origin, userId, a, b, oa, ob, user, selected, tokenA, tokenB, ignoredKey, calls,
    context: { userId, membershipId: b }, fresh: new RemoteSkillsAuthClient(origin), client: new RemoteSkillsClient(tokenA, origin),
    override(value?: Override) { override = value; } };
}
const email = "owner@example.test", code = "123456";

test("fresh leave selects only observed membership and performs one exact POST with no key persistence", async () => fixture(async f => {
  expect(await f.fresh.leaveWorkspace(email, code, f.context, { expectedRole: "viewer", confirm: true })).toEqual({ organizationId: f.ob, membershipId: f.b, removed: true, signInRequired: true });
  expect(f.calls.map(c => [c.method, c.path])).toEqual([
    ["POST", "/prefix/api/auth/verify"], ["GET", "/prefix/api/auth/whoami"],
    ["POST", "/prefix/api/v1/account/workspaces/switch"], ["GET", "/prefix/api/auth/whoami"],
    ["GET", "/prefix/api/auth/whoami"], ["POST", "/prefix/api/v1/account/workspaces/leave"],
  ]);
  expect(f.calls.at(-1)?.body).toEqual({ membershipId: f.b, expectedRole: "viewer" });
  expect(f.calls.at(-1)?.auth).toBe(`Bearer ${f.tokenB}`);
  expect(f.calls.every(c => c.cookie === null)).toBe(true);
}));

test("leave requires exact context and deliberate confirmation before any network call", async () => fixture(async f => {
  for (const input of [null, {}, { expectedRole: "viewer" }, { expectedRole: "viewer", confirm: false }, { expectedRole: "VIEWER", confirm: true }, { expectedRole: "viewer", confirm: true, force: true }])
    await expect(f.fresh.leaveWorkspace(email, code, f.context, input as never)).rejects.toThrow();
  for (const context of [undefined, {}, { ...f.context, membershipId: "bad" }, { ...f.context, organizationId: f.ob }])
    await expect(f.fresh.leaveWorkspace(email, code, context as never, { expectedRole: "viewer", confirm: true })).rejects.toThrow();
  expect(f.calls).toEqual([]);
}));

test("direct leave refuses key authority and a different active membership before POST", async () => fixture(async f => {
  await expect(f.client.leaveWorkspace(f.context, { expectedRole: "owner", confirm: true })).rejects.toThrow(WorkspaceIdentityMismatchError);
  f.override((_req, call) => call.path.endsWith("/whoami") ? Response.json({ user: f.selected.user, organization: f.selected.organization, authMethod: "api_key" }) : undefined);
  await expect(new RemoteSkillsClient(f.tokenB, f.origin).leaveWorkspace(f.context, { expectedRole: "owner", confirm: true })).rejects.toThrow(RemoteWorkspaceLeaveError);
  expect(f.calls.every(c => c.method === "GET")).toBe(true);
}));

test("server safeguards remain explicit and unknown or lost leave outcomes never retry or follow redirects", async () => fixture(async f => {
  let forwarded = 0;
  const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { forwarded++; return Response.json({}); } });
  try {
    const selected = new RemoteSkillsClient(f.tokenB, f.origin);
    for (const [status, errorCode] of [[409, "LAST_OWNER_REQUIRED"], [409, "LAST_WORKSPACE_REQUIRED"], [409, "MEMBERSHIP_ROLE_CHANGED"], [503, "MEMBERSHIP_BUSY"]] as const) {
      f.override((_req, call) => call.path.endsWith("/leave") ? Response.json({ code: errorCode, error: f.ignoredKey }, { status }) : undefined);
      const before = f.calls.length;
      await expect(selected.leaveWorkspace(f.context, { expectedRole: "viewer", confirm: true })).rejects.toMatchObject({ code: errorCode, status });
      expect(f.calls).toHaveLength(before + 2);
    }
    for (const response of [Response.json({}), Response.json({ organizationId: f.oa, membershipId: f.b, removed: true, signInRequired: true }),
      Response.json({ organizationId: f.ob, membershipId: f.a, removed: true, signInRequired: true }),
      new Response("invalid"), new Response("x".repeat(4097)), Response.json({ code: "LAST_OWNER_REQUIRED" }, { status: 500 }),
      new Response(null, { status: 307, headers: { location: other.url.origin } })]) {
      f.override((_req, call) => call.path.endsWith("/leave") ? response : undefined);
      const before = f.calls.length;
      await expect(selected.leaveWorkspace(f.context, { expectedRole: "viewer", confirm: true })).rejects.toThrow(RemoteWorkspaceLeaveUnconfirmedError);
      expect(f.calls).toHaveLength(before + 2);
    }
    expect(forwarded).toBe(0);
  } finally { await other.stop(true); }
}));

test("captured leave cannot retarget user, membership, role or origin during fresh authentication", async () => fixture(async f => {
  let release!: () => void, observed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { observed = resolve; });
  f.override(async (_req, call) => { if (call.path.endsWith("/verify")) { observed(); await gate; } return undefined; });
  const context = { ...f.context }, input = { expectedRole: "viewer" as "viewer" | "owner", confirm: true as const };
  const pending = f.fresh.leaveWorkspace(email, code, context, input);
  try {
    await seen; context.userId = randomUUID(); context.membershipId = f.a; input.expectedRole = "owner";
    Object.defineProperty(f.fresh, "apiOrigin", { value: "http://127.0.0.1:1/other" });
    release(); await pending;
    expect(f.calls.at(-1)?.body).toEqual({ membershipId: f.b, expectedRole: "viewer" });
  } finally { release(); await pending.catch(() => {}); }
}));

test("connection loss after accepting leave does not retry or query a replacement membership", async () => fixture(async f => {
  f.override(async (_req, call) => { if (call.path.endsWith("/leave")) { void f.server.stop(true); return Response.json({}); } return undefined; });
  await expect(new RemoteSkillsClient(f.tokenB, f.origin).leaveWorkspace(f.context, { expectedRole: "viewer", confirm: true })).rejects.toThrow(RemoteWorkspaceLeaveUnconfirmedError);
  expect(f.calls.map(c => c.method)).toEqual(["GET", "POST"]);
}));
