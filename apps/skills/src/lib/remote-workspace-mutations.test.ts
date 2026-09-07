import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RemoteSkillsClient, RemoteRequestError, RemoteRouteUnsupportedError, RemoteWorkspaceMemberError } from "./remote-client.js";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import type { SetRemoteWorkspaceMemberRole } from "./remote-workspace.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

type Reply = { body: unknown; status?: number; raw?: boolean; redirect?: string };
async function fixture(action: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup(); try { await action(f); } finally { await f.server.stop(true); }
}
async function setup() {
  const member = { membershipId: randomUUID(), userId: randomUUID(), email: "member@example.test", displayName: null,
    role: "viewer" as const, createdAt: "2026-09-07T00:00:00.123456Z" };
  const result = { organizationId: randomUUID(), member, changed: true };
  const removed = { organizationId: result.organizationId, membershipId: member.membershipId, removed: true as const, alreadyRemoved: false };
  const session = randomUUID(), ignoredKey = randomUUID(), code = "132465", calls: Array<{ path: string; method: string; body: unknown; auth: string | null }> = [];
  let reply: Reply = { body: result }, verifyGate: (() => Promise<void>) | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json(); const path = new URL(request.url).pathname + new URL(request.url).search;
    calls.push({ path, method: request.method, body, auth: request.headers.get("authorization") });
    if (path === "/prefix/api/auth/verify") {
      await verifyGate?.();
      return Response.json({ token: session, apiKey: ignoredKey });
    }
    if (reply.redirect) return new Response(null, { status: 307, headers: { location: reply.redirect } });
    return reply.raw ? new Response(String(reply.body), { status: reply.status ?? 200 }) : Response.json(reply.body, { status: reply.status ?? 200 });
  } });
  const origin = `${server.url.origin}/prefix/api/v1`;
  return { server, origin, session, ignoredKey, code, calls, result, removed,
    client: new RemoteSkillsClient(session, origin), fresh: new RemoteSkillsAuthClient(origin),
    reply(value: Reply) { reply = value; }, gate(value: () => Promise<void>) { verifyGate = value; } };
}

test("member HTTP adapters preserve exact request, no-op and tombstone replay results without extra requests", async () => fixture(async f => {
  const id = f.result.member.membershipId, input = { role: "viewer", expectedRole: "member" } as const;
  expect(await f.client.setWorkspaceMemberRole(id, input)).toEqual(f.result);
  f.reply({ body: { ...f.result, changed: false, privateCanary: f.ignoredKey } });
  expect(await f.fresh.setWorkspaceMemberRole("owner@example.test", f.code, id, input)).toEqual({ ...f.result, changed: false });
  f.reply({ body: f.removed });
  expect(await f.client.removeWorkspaceMember(id, { expectedRole: "viewer" })).toEqual(f.removed);
  f.reply({ body: { ...f.removed, alreadyRemoved: true, privateCanary: f.ignoredKey } });
  expect(await f.fresh.removeWorkspaceMember("owner@example.test", f.code, id, { expectedRole: "member" })).toEqual({ ...f.removed, alreadyRemoved: true });
  expect(f.calls.map(({ path, method, body }) => ({ path, method, body }))).toEqual([
    { path: `/prefix/api/v1/workspace/members/${id}`, method: "PATCH", body: input },
    { path: "/prefix/api/auth/verify", method: "POST", body: { email: "owner@example.test", code: f.code } },
    { path: `/prefix/api/v1/workspace/members/${id}`, method: "PATCH", body: input },
    { path: `/prefix/api/v1/workspace/members/${id}`, method: "DELETE", body: { expectedRole: "viewer" } },
    { path: "/prefix/api/auth/verify", method: "POST", body: { email: "owner@example.test", code: f.code } },
    { path: `/prefix/api/v1/workspace/members/${id}`, method: "DELETE", body: { expectedRole: "member" } },
  ]);
  for (const call of f.calls) expect(call.auth).toBe(call.path.endsWith("/verify") ? null : `Bearer ${f.session}`);
}));

test("invalid member inputs refuse before verification or HTTP, including unsupported selectors", async () => fixture(async f => {
  const id = f.result.member.membershipId;
  for (const target of ["", "not-an-id", id.toUpperCase(), `${id}?force=1`, `${id}/other`]) {
    await expect(f.client.setWorkspaceMemberRole(target, { role: "viewer", expectedRole: "member" })).rejects.toThrow();
    await expect(f.fresh.removeWorkspaceMember("owner@example.test", f.code, target, { expectedRole: "member" })).rejects.toThrow();
  }
  for (const input of [null, [], {}, { role: "viewer" }, { role: "OWNER", expectedRole: "member" }, { role: "viewer", expectedRole: null },
    { role: "viewer", expectedRole: "member", organizationId: randomUUID() }]) {
    await expect(f.fresh.setWorkspaceMemberRole("owner@example.test", f.code, id, input as never)).rejects.toThrow();
    await expect(f.client.setWorkspaceMemberRole(id, input as never)).rejects.toThrow();
  }
  for (const input of [null, {}, { expectedRole: "MEMBER" }, { expectedRole: "member", role: "viewer" }, { expectedRole: "member", force: true }])
    await expect(f.fresh.removeWorkspaceMember("owner@example.test", f.code, id, input as never)).rejects.toThrow();
  expect(f.calls).toEqual([]);
}));

test("all documented roles remain transport inputs; the client does not infer the actor's policy", async () => fixture(async f => {
  for (const role of ["owner", "admin", "member", "viewer"] as const) {
    const result = { ...f.result, member: { ...f.result.member, role } };
    f.reply({ body: result });
    expect(await f.client.setWorkspaceMemberRole(f.result.member.membershipId, { role, expectedRole: "owner" })).toEqual(result);
    expect(f.calls.at(-1)?.body).toEqual({ role, expectedRole: "owner" });
  }
  expect(f.calls).toHaveLength(4);
}));

test("fresh verification cannot replace captured target, roles or selected origin during its await", async () => {
  let forwarded = 0;
  const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { forwarded++; return Response.json({}); } });
  try { for (const action of ["role", "remove"] as const) await fixture(async f => {
    let release!: () => void, observed!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen = new Promise<void>(resolve => { observed = resolve; });
    f.gate(async () => { observed(); await gate; });
    const input: SetRemoteWorkspaceMemberRole = { role: "viewer", expectedRole: "member" };
    const removal = { expectedRole: "member" as "member" | "owner" };
    let id = f.result.member.membershipId;
    if (action === "remove") f.reply({ body: f.removed });
    const pending = action === "role" ? f.fresh.setWorkspaceMemberRole("owner@example.test", f.code, id, input)
      : f.fresh.removeWorkspaceMember("owner@example.test", f.code, id, removal);
    try {
      await seen; input.role = "owner"; input.expectedRole = "owner"; removal.expectedRole = "owner"; id = randomUUID();
      Object.defineProperty(f.fresh, "apiOrigin", { value: other.url.origin });
      release(); await pending;
      expect(f.calls.at(-1)?.path).toBe(`/prefix/api/v1/workspace/members/${f.result.member.membershipId}`);
      expect(f.calls.at(-1)?.body).toEqual(action === "role" ? { role: "viewer", expectedRole: "member" } : { expectedRole: "member" });
      expect(f.calls).toHaveLength(2); expect(forwarded).toBe(0);
    } finally { release(); await pending.catch(() => {}); }
  }); } finally { await other.stop(true); }
});

test("member results refuse malformed, misbound and oversized success payloads", async () => fixture(async f => {
  const id = f.result.member.membershipId, row = f.result.member;
  for (const body of [null, {}, { ...f.result, changed: "yes" }, { ...f.result, organizationId: null },
    ...[null, {}, { ...row, membershipId: randomUUID() }, { ...row, role: "owner" }, { ...row, createdAt: "2026-09-07T00:00:00.123Z" },
      { ...row, userId: undefined }, { ...row, displayName: "x".repeat(70_000) }].map(member => ({ ...f.result, member }))]) {
    f.reply({ body }); await expect(f.client.setWorkspaceMemberRole(id, { role: "viewer", expectedRole: "member" })).rejects.toThrow("invalid workspace member result");
  }
  for (const body of [null, {}, { ...f.removed, membershipId: randomUUID() }, { ...f.removed, removed: false },
    { ...f.removed, alreadyRemoved: "yes" }, { ...f.removed, organizationId: undefined }]) {
    f.reply({ body }); await expect(f.client.removeWorkspaceMember(id, { expectedRole: "member" })).rejects.toThrow("invalid workspace member result");
  }
  f.reply({ body: `<html>${f.ignoredKey}</html>`, raw: true });
  await expect(f.client.removeWorkspaceMember(id, { expectedRole: "member" })).rejects.toThrow("invalid workspace member result");
}));

test("member errors preserve allowlisted status/code and distinguish domain absence without automatic retry", async () => fixture(async f => {
  const cases = [["INVALID_REQUEST", 400], ["ACCOUNT_UNAVAILABLE", 403], ["INTERACTIVE_SESSION_REQUIRED", 403],
    ["WORKSPACE_ADMIN_REQUIRED", 403], ["MEMBERSHIP_ACTION_FORBIDDEN", 403], ["MEMBERSHIP_NOT_FOUND", 404],
    ["SELF_REMOVAL_UNAVAILABLE", 409], ["MEMBERSHIP_ROLE_CHANGED", 409], ["LAST_OWNER_REQUIRED", 409], ["MEMBERSHIP_BUSY", 503]] as const;
  for (const [code, status] of cases) {
    f.reply({ status, body: { code, error: f.ignoredKey } }); const before = f.calls.length;
    const error = await f.client.removeWorkspaceMember(f.result.member.membershipId, { expectedRole: "member" }).catch(error => error);
    expect(error).toBeInstanceOf(RemoteWorkspaceMemberError); expect(error).toBeInstanceOf(RemoteRequestError);
    expect(error.code).toBe(code); expect(error.status).toBe(status); expect(error.message).not.toContain(f.ignoredKey); expect(f.calls).toHaveLength(before + 1);
  }
  for (const status of [401, 403, 404, 405, 409, 503, 500]) {
    f.reply({ status, body: { code: f.ignoredKey, error: f.ignoredKey } });
    const error = await f.client.setWorkspaceMemberRole(f.result.member.membershipId, { role: "viewer", expectedRole: "member" }).catch(error => error);
    expect(error).toBeInstanceOf(status === 404 || status === 405 ? RemoteRouteUnsupportedError : RemoteRequestError);
    expect(error).not.toBeInstanceOf(RemoteWorkspaceMemberError); expect(error.message).not.toContain(f.ignoredKey);
  }
  f.reply({ status: 500, body: { code: "MEMBERSHIP_ROLE_CHANGED", error: f.ignoredKey } });
  await expect(f.client.removeWorkspaceMember(f.result.member.membershipId, { expectedRole: "member" })).rejects.not.toBeInstanceOf(RemoteWorkspaceMemberError);
}));

test("member transports refuse cross-authority redirects without forwarding credentials", async () => {
  let forwarded = 0;
  const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { forwarded++; return Response.json({}); } });
  try { await fixture(async f => {
    f.reply({ body: {}, redirect: other.url.href });
    await expect(f.client.removeWorkspaceMember(f.result.member.membershipId, { expectedRole: "member" })).rejects.toThrow();
    expect(f.calls).toHaveLength(1); expect(forwarded).toBe(0);
  }); } finally { await other.stop(true); }
});
