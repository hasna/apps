import { expect, test } from "bun:test";
import { RemoteSkillsClient, RemoteRequestError, RemoteRouteUnsupportedError } from "./remote-client.js";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { customerNamePatch } from "./remote-profile.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

test("name wire input preserves international text and rejects unsupported patch authority", () => {
  expect(customerNamePatch({ displayName: "  Ana 林  " }, "displayName")).toEqual({ displayName: "Ana 林" });
  expect(customerNamePatch({ name: "🦆".repeat(100) }, "name")).toEqual({ name: "🦆".repeat(100) });
  for (const value of [null, 3, [], "name", {}, { name: "" }, { name: "a\nb" }, { name: "\ud800" }, { name: "🦆".repeat(101) },
    ...["id", "role", "email", "slug", "metadata", "organizationId"].map(field => ({ name: "Ana", [field]: "attempt" }))]) {
    expect(() => customerNamePatch(value, "name")).toThrow();
  }
});

test("SDK and fresh auth use exact prefixed routes, safe projections and ephemeral session authority", async () => {
  const calls: Array<{ path: string; method: string; body: unknown; auth: string | null }> = [];
  let mode: "ok" | "bad" | "forbidden" | "unsupported" | "redirect" = "ok";
  let forwarded = 0;
  const destination = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { forwarded++; return Response.json({}); } });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = await req.json() as Record<string, string>;
    calls.push({ path, method: req.method, body, auth: req.headers.get("authorization") });
    if (path.endsWith("/verify")) return Response.json({ token: "ephemeral-fixture-session" });
    if (mode === "bad") return Response.json({});
    if (mode === "forbidden") return Response.json({ error: "fixture-response-canary" }, { status: 403 });
    if (mode === "unsupported") return Response.json({}, { status: 404 });
    if (mode === "redirect") return new Response(null, { status: 307, headers: { location: destination.url.toString() } });
    return Response.json(path.endsWith("/profile")
      ? { user: { id: "user", email: "reader@example.test", displayName: body.displayName, role: "viewer", metadata: { private: "omitted" } } }
      : { organization: { id: "workspace", slug: "unchanged", name: body.name, metadata: { private: "omitted" } } });
  } });
  const origin = `${server.url.origin}/prefix/api/v1`;
  const client = new RemoteSkillsClient("fixture-session", origin);
  const auth = new RemoteSkillsAuthClient(origin);
  try {
    expect(await client.updateProfile({ displayName: " Ana 林 " })).toEqual({ user: { id: "user", email: "reader@example.test", displayName: "Ana 林", role: "viewer" } });
    expect(await client.updateCurrentWorkspace({ name: "Studio" })).toEqual({ organization: { id: "workspace", slug: "unchanged", name: "Studio" } });
    await auth.updateProfile("reader@example.test", "123456", { displayName: "Fresh Ana" });
    await auth.updateCurrentWorkspace("reader@example.test", "123456", { name: "Fresh Studio" });
    expect(calls.map(call => [call.path, call.method, call.auth])).toEqual([
      ["/prefix/api/v1/account/profile", "PATCH", "Bearer fixture-session"],
      ["/prefix/api/v1/workspaces/current", "PATCH", "Bearer fixture-session"],
      ["/prefix/api/auth/verify", "POST", null], ["/prefix/api/v1/account/profile", "PATCH", "Bearer ephemeral-fixture-session"],
      ["/prefix/api/auth/verify", "POST", null], ["/prefix/api/v1/workspaces/current", "PATCH", "Bearer ephemeral-fixture-session"],
    ]);
    expect(calls[3]?.body).toEqual({ displayName: "Fresh Ana" });
    expect(calls[5]?.body).toEqual({ name: "Fresh Studio" });
    const count = calls.length;
    await expect(auth.updateProfile("reader@example.test", "123456", { displayName: "Ana", role: "owner" } as never)).rejects.toThrow();
    await expect(auth.updateProfile("reader@example.test", "not-a-code", { displayName: "Ana" })).rejects.toThrow();
    expect(calls.length).toBe(count);
    mode = "bad";
    await expect(client.updateProfile({ displayName: "Ana" })).rejects.toThrow("invalid account profile");
    await expect(client.updateCurrentWorkspace({ name: "Studio" })).rejects.toThrow("invalid workspace");
    mode = "forbidden";
    await expect(client.updateProfile({ displayName: "Ana" })).rejects.toBeInstanceOf(RemoteRequestError);
    mode = "unsupported";
    await expect(client.updateCurrentWorkspace({ name: "Studio" })).rejects.toBeInstanceOf(RemoteRouteUnsupportedError);
    mode = "redirect";
    await expect(client.updateProfile({ displayName: "Ana" })).rejects.toThrow();
    expect(forwarded).toBe(0);
  } finally { await server.stop(true); await destination.stop(true); }
});
