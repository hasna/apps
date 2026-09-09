import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RemoteSkillsClient } from "./remote-client.js";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { invitationFailures, RemoteWorkspaceInvitationError, RemoteWorkspaceInvitationReadError, RemoteWorkspaceInvitationUnconfirmedError, WorkspaceInvitationInputError,
  type InvitationAction, type RemoteWorkspaceInvitation } from "./remote-invitations.js";
import { WorkspaceIdentityMismatchError } from "./remote-workspace-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

const email = "owner@example.test", recipient = "recipient@example.test", code = "123456", token = "a".repeat(43);
type Call = { path: string; method: string; body: unknown; authorization: string | null };
async function fixture(action: (f: ReturnType<typeof setup>) => Promise<void>) { const f = setup(); try { await action(f); } finally { await f.server.stop(true); } }
function setup() {
  const userId = randomUUID(), a = randomUUID(), b = randomUUID(), oa = randomUUID(), ob = randomUUID(), joinedOrg = randomUUID(), joinedMid = randomUUID();
  const tokenA = `session-a-${randomUUID()}`, tokenB = `session-b-${randomUUID()}`, key = `sk_${randomUUID()}`, requestKey = randomUUID();
  const context = { userId, membershipId: b }, invitation: RemoteWorkspaceInvitation = { id: randomUUID(), organizationId: ob, email: recipient, role: "member", generation: 1,
    status: "pending", createdAt: "2026-09-07T10:00:00+00:00", expiresAt: "2026-09-14T10:00:00.123456+00:00", delivery: { state: "queued", attempts: 0 } };
  const accepted = { organizationId: joinedOrg, membershipId: joinedMid, accepted: true as const, changed: true };
  const calls: Call[] = [];
  let override: ((req: Request, call: Call) => Response | undefined | Promise<Response | undefined>) | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname + new URL(req.url).search, call = { path, method: req.method, body: req.method === "GET" ? undefined : await req.json(), authorization: req.headers.get("authorization") };
    calls.push(call); const changed = await override?.(req, call); if (changed) return changed;
    const selected = call.authorization === `Bearer ${tokenB}`, user = { id: userId, membershipId: selected ? b : a, email, displayName: null, role: "owner" };
    const organization = { id: selected ? ob : oa, slug: selected ? "selected" : "original", name: "Owned" };
    if (path.endsWith("/api/auth/verify")) return Response.json({ token: tokenA, user: { id: userId }, apiKey: key });
    if (path.endsWith("/api/auth/whoami")) return Response.json({ user, organization, authMethod: call.authorization === `Bearer ${key}` ? "api_key" : "jwt" });
    if (path.endsWith("/account/workspaces/switch")) return Response.json({ token: tokenB, user: { ...user, membershipId: b }, organization: { ...organization, id: ob } });
    if (!selected) return Response.json({ code: "INVITATION_FORBIDDEN", error: token }, { status: 403 });
    if (path.endsWith("/account/invitations/accept")) return Response.json({ ...accepted, token });
    if (path.endsWith("/workspace/invitations") && req.method === "GET") return Response.json({ organizationId: ob, invitations: [{ ...invitation, token }], nextCursor: null, token });
    if (path.endsWith("/workspace/invitations") && req.method === "POST") return Response.json({ invitation, changed: true, token }, { status: 201 });
    if (path.endsWith("/resend")) return Response.json({ invitation: { ...invitation, generation: 2 }, changed: true });
    if (req.method === "DELETE") return Response.json({ invitation: { ...invitation, status: "revoked" }, changed: true });
    return Response.json({ invitation });
  } });
  const origin = `${server.url.origin}/prefix/api/v1`, fresh = new RemoteSkillsAuthClient(origin), client = new RemoteSkillsClient(tokenB, origin);
  return { server, origin, fresh, client, context, invitation, accepted, calls, tokenA, tokenB, key, requestKey, ob,
    override(value: typeof override) { override = value; } };
}
function operation(f: ReturnType<typeof setup>, action: InvitationAction, fresh = false) {
  const issue = { email: recipient, role: "member" as const, idempotencyKey: f.requestKey, confirm: true as const }, resend = { expectedGeneration: 1, idempotencyKey: f.requestKey, confirm: true as const };
  if (fresh) {
    switch (action) {
      case "list": return f.fresh.listWorkspaceInvitations(email, code, f.context);
      case "get": return f.fresh.getWorkspaceInvitation(email, code, f.context, f.invitation.id);
      case "issue": return f.fresh.issueWorkspaceInvitation(email, code, f.context, issue);
      case "resend": return f.fresh.resendWorkspaceInvitation(email, code, f.context, f.invitation.id, resend);
      case "revoke": return f.fresh.revokeWorkspaceInvitation(email, code, f.context, f.invitation.id, { expectedGeneration: 1, confirm: true });
      case "accept": return f.fresh.acceptWorkspaceInvitation(email, code, f.context, f.invitation.id, { token, confirm: true });
    }
  }
  switch (action) {
    case "list": return f.client.listWorkspaceInvitations(f.context);
    case "get": return f.client.getWorkspaceInvitation(f.context, f.invitation.id);
    case "issue": return f.client.issueWorkspaceInvitation(f.context, issue);
    case "resend": return f.client.resendWorkspaceInvitation(f.context, f.invitation.id, resend);
    case "revoke": return f.client.revokeWorkspaceInvitation(f.context, f.invitation.id, { expectedGeneration: 1, confirm: true });
    case "accept": return f.client.acceptWorkspaceInvitation(f.context, f.invitation.id, { token, confirm: true });
  }
}
const actions = ["list", "get", "issue", "resend", "revoke", "accept"] as const;
test("array-valued status and delivery state refuse list/get and leave mutation outcomes unconfirmed without retry", () => fixture(async f => {
  for (const malformed of [{ status: ["pending"] }, { delivery: { state: ["queued"], attempts: 0 } }]) {
    for (const action of ["list", "get", "issue"] as const) {
      f.override((_req, c) => c.path.includes("/invitations") ? Response.json(action === "list"
        ? { organizationId: f.ob, invitations: [{ ...f.invitation, ...malformed }], nextCursor: null }
        : { invitation: { ...f.invitation, ...malformed }, changed: true }) : undefined);
      const before = f.calls.length;
      await expect(operation(f, action)).rejects.toBeInstanceOf(action === "issue" ? RemoteWorkspaceInvitationUnconfirmedError : RemoteWorkspaceInvitationReadError);
      expect(f.calls.slice(before).filter(c => c.path.includes("/invitations"))).toHaveLength(1);
    }
  }
}));
test("all six invitation operations use the selected origin and exact context, without leaking extras or selecting accepted membership", () => fixture(async f => {
  for (const fresh of [false, true]) for (const action of actions) {
    const before = f.calls.length, result = await operation(f, action, fresh), calls = f.calls.slice(before);
    expect(JSON.stringify(result)).not.toContain(token); expect(JSON.stringify(result)).not.toContain(f.key);
    expect(calls.at(-1)?.authorization).toBe(`Bearer ${f.tokenB}`);
    expect(calls.every(c => c.path.startsWith("/prefix/api/"))).toBe(true);
    expect(calls.filter(c => /workspace\/invitations|account\/invitations/.test(c.path))).toHaveLength(1);
    expect(calls.filter(c => c.path.endsWith("/switch"))).toHaveLength(fresh ? 1 : 0);
    if (action === "issue") expect(calls.at(-1)?.body).toEqual({ email: recipient, role: "member", idempotencyKey: f.requestKey });
    if (action === "resend") expect(calls.at(-1)?.body).toEqual({ expectedGeneration: 1, idempotencyKey: f.requestKey });
    if (action === "revoke") expect(calls.at(-1)?.body).toEqual({ expectedGeneration: 1 });
    if (action === "accept") { expect(calls.at(-1)?.body).toEqual({ invitationId: f.invitation.id, token }); expect(result).toEqual(f.accepted); }
  }
}));
test("invalid fields, confirmation, target or key refuse before authentication; caller mutation cannot retarget a request", () => fixture(async f => {
  const issue = { email: recipient, role: "member" as const, idempotencyKey: f.requestKey, confirm: true as const };
  for (const input of [{ ...issue, confirm: false }, { ...issue, idempotencyKey: "bad" }, { ...issue, email: "bad\n@example.test" }, { ...issue, organizationId: randomUUID() }, { ...issue, role: "superuser" }])
    await expect(f.fresh.issueWorkspaceInvitation(email, code, f.context, input as never)).rejects.toBeInstanceOf(WorkspaceInvitationInputError);
  await expect(f.fresh.resendWorkspaceInvitation(email, code, f.context, "bad", { expectedGeneration: 1, idempotencyKey: f.requestKey, confirm: true })).rejects.toThrow();
  await expect(f.fresh.revokeWorkspaceInvitation(email, code, f.context, f.invitation.id, { expectedGeneration: 11, confirm: true })).rejects.toThrow();
  await expect(f.fresh.acceptWorkspaceInvitation(email, code, f.context, f.invitation.id, { token: "bad", confirm: true })).rejects.toThrow();
  await expect(f.fresh.listWorkspaceInvitations(email, code, f.context, { after: "bad" })).rejects.toThrow();
  expect(f.calls).toEqual([]);
  const context = { ...f.context }, input = { ...issue }, pending = f.fresh.issueWorkspaceInvitation(email, code, context, input);
  context.membershipId = randomUUID(); input.email = "changed@example.test"; input.idempotencyKey = randomUUID();
  await pending;
  expect(f.calls.find(c => c.path.endsWith("/switch"))?.body).toEqual({ membershipId: f.context.membershipId });
  expect(f.calls.at(-1)?.body).toEqual({ email: recipient, role: "member", idempotencyKey: f.requestKey });
}));
test("wrong verified identity, membership and API keys never reach invitation mutation", () => fixture(async f => {
  f.override((_req, c) => c.path.endsWith("/verify") ? Response.json({ token: f.tokenA, user: { id: randomUUID() } }) : undefined);
  await expect(operation(f, "issue", true)).rejects.toBeInstanceOf(WorkspaceIdentityMismatchError);
  f.override(undefined);
  await expect(new RemoteSkillsClient(f.tokenA, f.origin).issueWorkspaceInvitation(f.context, { email: recipient, role: "owner", idempotencyKey: f.requestKey, confirm: true })).rejects.toBeInstanceOf(WorkspaceIdentityMismatchError);
  await expect(new RemoteSkillsClient(f.key, f.origin).issueWorkspaceInvitation(f.context, { email: recipient, role: "owner", idempotencyKey: f.requestKey, confirm: true })).rejects.toMatchObject({ code: "INTERACTIVE_SESSION_REQUIRED" });
  expect(f.calls.some(c => c.path.includes("/invitations"))).toBe(false);
}));
test("known role/tenant/lifecycle refusals use fixed errors; unknown or lost mutation outcomes never retry", () => fixture(async f => {
  for (const [failure, [status]] of Object.entries(invitationFailures)) {
    f.override((_req, c) => c.path.includes("/invitations") ? Response.json({ code: failure, error: token, ciphertext: f.key }, { status }) : undefined);
    await expect(operation(f, "issue")).rejects.toMatchObject({ code: failure, status });
    try { await operation(f, "issue"); } catch (e) { expect(String(e)).not.toContain(token); expect(e).toBeInstanceOf(RemoteWorkspaceInvitationError); }
  }
  for (const reply of [() => Response.json({ code: "UNKNOWN", error: token }, { status: 500 }), () => Response.json({ code: "INVITATION_FORBIDDEN", error: token }, { status: 500 }), () => new Response(token), () => Response.json({ oversized: "x".repeat(65537) })]) {
    f.override((_req, c) => c.path.includes("/invitations") ? reply() : undefined);
    for (const action of actions) {
      const before = f.calls.length;
      await expect(operation(f, action)).rejects.toBeInstanceOf(action === "list" || action === "get" ? RemoteWorkspaceInvitationReadError : RemoteWorkspaceInvitationUnconfirmedError);
      expect(f.calls.slice(before).filter(c => c.path.includes("/invitations"))).toHaveLength(1);
    }
  }
  let forwarded = 0; const outside = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { forwarded++; return Response.json({}); } });
  try { f.override((_req, c) => c.path.includes("/invitations") ? Response.redirect(outside.url) : undefined);
    await expect(operation(f, "accept")).rejects.toBeInstanceOf(RemoteWorkspaceInvitationUnconfirmedError); expect(forwarded).toBe(0);
  } finally { outside.stop(true); }
}));
test("response identity, generations and sorted bounded pagination must match their request", () => fixture(async f => {
  for (const changed of [{ organizationId: randomUUID() }, { id: randomUUID() }, { generation: 11 }, { email: "bad\n@example.test" }, { delivery: { state: "queued", attempts: 6 } }]) {
    f.override((_req, c) => c.path.includes("/invitations") ? Response.json({ invitation: { ...f.invitation, ...changed } }) : undefined);
    await expect(operation(f, "get")).rejects.toBeInstanceOf(RemoteWorkspaceInvitationReadError);
  }
  for (const page of [
    { invitations: [f.invitation, f.invitation], nextCursor: null },
    { invitations: [f.invitation], nextCursor: f.invitation.id },
    { invitations: Array.from({ length: 51 }, () => f.invitation), nextCursor: null },
    { invitations: [], nextCursor: f.invitation.id },
  ]) {
    f.override((_req, c) => c.path.includes("/invitations") ? Response.json({ organizationId: f.ob, ...page }) : undefined);
    await expect(operation(f, "list")).rejects.toBeInstanceOf(RemoteWorkspaceInvitationReadError);
  }
  f.override((_req, c) => c.path.includes("/invitations") ? Response.json({ invitation: f.invitation, changed: true }) : undefined);
  await expect(operation(f, "resend")).rejects.toBeInstanceOf(RemoteWorkspaceInvitationUnconfirmedError);
  await expect(operation(f, "revoke")).rejects.toBeInstanceOf(RemoteWorkspaceInvitationUnconfirmedError);
  f.override((_req, c) => c.path.includes("/invitations") ? Response.json({ organizationId: f.ob, invitations: [f.invitation], nextCursor: null }) : undefined);
  await expect(f.client.listWorkspaceInvitations(f.context, { after: f.invitation.id })).rejects.toBeInstanceOf(RemoteWorkspaceInvitationReadError);
}));
