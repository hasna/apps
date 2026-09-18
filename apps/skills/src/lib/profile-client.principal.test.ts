import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, expect, test } from "bun:test";
import { HttpProfileClient } from "./profile-client.js";
import { skillsApiRequestUrl } from "./fleet-credentials.js";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.stop(true); });

test("whoami is bounded, strict, and returns stable user/account/role identity", async () => {
  const calls: Array<{ path: string; authorization: string | null }> = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    const url = new URL(request.url);
    calls.push({ path: url.pathname, authorization: request.headers.get("authorization") });
    return Response.json({
      user: { id: "owner-user", email: "owner@example.test", role: "owner" },
      organization: { id: "account-id", slug: "account-slug", name: "Account" },
    });
  } });
  servers.push(server);
  const client = new HttpProfileClient("secret-fixture-key", `${server.url.origin}/prefix`);
  await expect(client.resolvePrincipal()).resolves.toEqual({ userId: "owner-user", accountId: "account-id", role: "owner" });
  expect(calls).toEqual([{ path: "/prefix/api/auth/whoami", authorization: "Bearer secret-fixture-key" }]);
});

test("whoami refuses unknown fields, missing identity, and unsupported roles", async () => {
  const replies: unknown[] = [
    { user: { id: "owner-user", email: "owner@example.test", role: "owner", extra: true }, organization: { id: "account-id", slug: "account", name: "Account" } },
    { user: { id: "owner-user", email: "owner@example.test", role: "operator" }, organization: { id: "account-id", slug: "account", name: "Account" } },
    { user: { id: "", email: "owner@example.test", role: "owner" }, organization: { id: "account-id", slug: "account", name: "Account" } },
  ];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { return Response.json(replies.shift()); } });
  servers.push(server);
  const client = new HttpProfileClient("secret-fixture-key", server.url.origin);
  for (let index = 0; index < 3; index++) await expect(client.resolvePrincipal()).rejects.toThrow("invalid profile response");
});

test("canonical hosted whoami uses the app base and appends v1 exactly once", () => {
  expect(skillsApiRequestUrl("https://api.hasna.com/skills", "/api/auth/whoami")).toBe("https://api.hasna.com/skills/v1/auth/whoami");
  expect(skillsApiRequestUrl("https://api.hasna.com/skills/v1", "/api/auth/whoami")).toBe("https://api.hasna.com/skills/v1/auth/whoami");
});
