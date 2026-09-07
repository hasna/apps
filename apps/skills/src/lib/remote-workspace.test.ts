import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RemoteSkillsClient, RemoteRequestError, RemoteRouteUnsupportedError } from "./remote-client.js";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { parseWorkspaceMembersPage, workspaceMembersQuery } from "./remote-workspace.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

const page = () => ({ organizationId: randomUUID(), members: [{ membershipId: randomUUID(), userId: randomUUID(),
  email: "reader@example.test", displayName: "Ana 林", role: "owner" as const, createdAt: "2026-01-02T03:04:05.123456Z" }], nextCursor: "opaque_cursor-A1" });

test("roster transport preserves opaque pagination and refuses unsupported selection before requests", () => {
  expect(workspaceMembersQuery()).toBe("");
  expect(workspaceMembersQuery({ limit: 1, cursor: "opaque_cursor-A1" })).toBe("?limit=1&cursor=opaque_cursor-A1");
  expect(workspaceMembersQuery({ limit: 100 })).toBe("?limit=100");
  for (const input of [null, [], 1, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: NaN }, { limit: "1" },
    { cursor: null }, { cursor: "" }, { cursor: "a".repeat(513) }, { cursor: " a" }, { cursor: "a&limit=100" },
    { organizationId: randomUUID() }, { membershipId: randomUUID() }, { role: "owner" }]) expect(() => workspaceMembersQuery(input as never)).toThrow();
});

test("safe roster projection preserves microseconds, required nullability and final empty pages", () => {
  const value = page();
  expect(parseWorkspaceMembersPage({ ...value, privateCanary: "omitted", members: value.members.map(row => ({ ...row, token: "omitted" })) })).toEqual(value);
  expect(parseWorkspaceMembersPage({ ...value, members: [{ ...value.members[0], displayName: null }], nextCursor: null }).members[0]!.displayName).toBeNull();
  expect(parseWorkspaceMembersPage({ ...value, members: [], nextCursor: null })).toEqual({ organizationId: value.organizationId, members: [], nextCursor: null });
  for (const broken of [null, {}, { ...value, organizationId: null }, { ...value, nextCursor: undefined },
    { ...value, nextCursor: "" }, { ...value, members: [] }, { ...value, members: [value.members[0], value.members[0]] },
    ...["membershipId", "userId", "email", "displayName", "role", "createdAt"].map(key => ({ ...value, members: [{ ...value.members[0], [key]: undefined }] })),
    ...[null, "moderator"].map(role => ({ ...value, members: [{ ...value.members[0], role }] })),
    ...["2026-01-02T03:04:05.123Z", "2026-02-30T03:04:05.123456Z", "2026-01-02T03:04:05.123456+00:00"].map(createdAt => ({ ...value, members: [{ ...value.members[0], createdAt }] }))]) {
    expect(() => parseWorkspaceMembersPage(broken)).toThrow("invalid workspace roster");
  }
});

test("actual HTTP uses prefixed read-only roster, fresh session and refusal without redirect forwarding", async () => {
  const expected = page(), calls: Array<{ path: string; method: string; auth: string | null }> = [];
  const session = randomUUID(), key = randomUUID(), code = "132465";
  let mode: "ok" | "denied" | "missing" | "bad" | "empty-continuation" | "repeated-cursor" | "invalid-json" | "redirect" = "ok", forwarded = 0;
  const destination = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { forwarded++; return Response.json({}); } });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url); calls.push({ path: url.pathname + url.search, method: request.method, auth: request.headers.get("authorization") });
    if (url.pathname === "/prefix/api/auth/verify") {
      const body = await request.json() as { email: string; code: string };
      return body.email === "reader@example.test" && body.code === code ? Response.json({ token: session, apiKey: key }) : Response.json({ error: key }, { status: 401 });
    }
    if (request.headers.get("authorization") !== `Bearer ${session}` || mode === "denied") return Response.json({ error: key }, { status: 403 });
    if (mode === "missing") return Response.json({ error: key }, { status: 404 });
    if (mode === "bad") return Response.json({ secret: key });
    if (mode === "empty-continuation") return Response.json({ ...expected, members: [] });
    if (mode === "repeated-cursor") return Response.json(expected);
    if (mode === "invalid-json") return new Response(`<error>${key}</error>`);
    if (mode === "redirect") return new Response(null, { status: 307, headers: { location: destination.url.href } });
    return Response.json(url.searchParams.has("cursor") ? { ...expected, members: [], nextCursor: null } : expected);
  } });
  const origin = `${server.url.origin}/prefix/api/v1`, client = new RemoteSkillsClient(session, origin), fresh = new RemoteSkillsAuthClient(origin);
  try {
    expect(await client.listWorkspaceMembers({ limit: 1 })).toEqual(expected);
    expect(await fresh.listWorkspaceMembers("reader@example.test", code, { limit: 1, cursor: expected.nextCursor })).toEqual({ ...expected, members: [], nextCursor: null });
    expect(calls).toEqual([
      { path: "/prefix/api/v1/workspace/members?limit=1", method: "GET", auth: `Bearer ${session}` },
      { path: "/prefix/api/auth/verify", method: "POST", auth: null },
      { path: "/prefix/api/v1/workspace/members?limit=1&cursor=opaque_cursor-A1", method: "GET", auth: `Bearer ${session}` },
    ]);
    const count = calls.length;
    await expect(fresh.listWorkspaceMembers("reader@example.test", code, { organizationId: randomUUID() } as never)).rejects.toThrow();
    await expect(fresh.listWorkspaceMembers("reader@example.test", "invalid")).rejects.toThrow();
    expect(calls.length).toBe(count);
    await expect(new RemoteSkillsClient(key, origin).listWorkspaceMembers()).rejects.toBeInstanceOf(RemoteRequestError);
    mode = "denied"; await expect(client.listWorkspaceMembers()).rejects.toBeInstanceOf(RemoteRequestError);
    mode = "missing"; await expect(client.listWorkspaceMembers()).rejects.toBeInstanceOf(RemoteRouteUnsupportedError);
    for (const broken of ["bad", "invalid-json"] as const) { mode = broken; await expect(client.listWorkspaceMembers()).rejects.toThrow("invalid workspace roster"); }
    mode = "empty-continuation"; await expect(client.listWorkspaceMembers()).rejects.toThrow("invalid workspace roster");
    mode = "repeated-cursor"; await expect(client.listWorkspaceMembers({ cursor: expected.nextCursor })).rejects.toThrow("invalid workspace roster");
    mode = "redirect"; await expect(client.listWorkspaceMembers()).rejects.toThrow(); expect(forwarded).toBe(0);
  } finally { await server.stop(true); await destination.stop(true); }
});
