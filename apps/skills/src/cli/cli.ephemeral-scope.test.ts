import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-cli-ephemeral-scope-"));
const binary = join(scratch, "skills.js");
beforeAll(() => buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const userId = "11111111-1111-4111-8111-111111111111";
const membershipId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const tokenA = "ephemeral-session-a", tokenB = "ephemeral-session-b";

async function invoke(serverOrigin: string, home: string, input: string, args: string[]) {
  const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], {
    cwd: home,
    env: { HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"), HASNA_SKILLS_API_URL: serverOrigin, HASNA_STATION: "ephemeral-scope-fixture", PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: "1", TMPDIR: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  child.stdin.write(input); child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
}

test("ephemeral scope CLI uses stdin only, binds the selected workspace and persists no session", async () => {
  const root = mkdtempSync(join(scratch, "success-")), home = join(root, "home"); mkdirSync(home);
  const calls: { path: string; method: string; token: string | null; body?: unknown }[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname, token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
    const body = request.method === "PATCH" || request.method === "POST" ? await request.json().catch(() => undefined) : undefined;
    calls.push({ path, method: request.method, token, body });
    if (path.endsWith("/api/auth/verify")) return Response.json({ token: tokenA, user: { id: userId, membershipId, email: "owner@example.test", displayName: null, role: "owner" }, organization: { id: organizationId, slug: "dev", name: "Development" } });
    if (path.endsWith("/api/auth/whoami") && token === tokenA) return Response.json({ authMethod: "jwt", user: { id: userId, membershipId, email: "owner@example.test", displayName: null, role: "owner" }, organization: { id: organizationId, slug: "dev", name: "Development" } });
    if (path.endsWith("/api/v1/account/workspaces/switch") && token === tokenA) return Response.json({ token: tokenB, user: { id: userId, membershipId, email: "owner@example.test", displayName: null, role: "owner" }, organization: { id: organizationId, slug: "dev", name: "Development" } });
    if (path.endsWith("/api/auth/whoami") && token === tokenB) return Response.json({ authMethod: "jwt", user: { id: userId, membershipId, email: "owner@example.test", displayName: null, role: "owner" }, organization: { id: organizationId, slug: "dev", name: "Development" } });
    if (path.endsWith("/api/v1/admin/keys/key_target/scopes") && token === tokenB) return Response.json({ keyId: "key_target", orgId: organizationId, scopes: ["skills:read", "skills:publish"], updated: true, nested: { token: "MUST_NOT_PRINT" } });
    return Response.json({ error: "not found" }, { status: 404 });
  } });
  try {
    const result = await invoke(server.url.origin, home, "123456\n", ["auth", "keys", "add-publish-scope", "key_target", "--expected-scopes", "skills:read", "--email", "owner@example.test", "--code-stdin", "--user-id", userId, "--membership-id", membershipId, "--organization-id", organizationId, "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ keyId: "key_target", orgId: organizationId, scopes: ["skills:read", "skills:publish"], updated: true });
    expect(result.stdout + result.stderr).not.toContain("123456");
    expect(result.stdout + result.stderr).not.toContain(tokenA);
    expect(result.stdout + result.stderr).not.toContain(tokenB);
    expect(calls.find(call => call.path.endsWith("/admin/keys/key_target/scopes"))).toMatchObject({ method: "PATCH", token: tokenB, body: { expected_scopes: ["skills:read"], add_scopes: ["skills:publish"] } });
    expect(readdirSync(home)).toEqual([]);
  } finally { await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test("ephemeral scope CLI rejects invalid scope inputs before consuming stdin or making requests", async () => {
  const root = mkdtempSync(join(scratch, "invalid-input-")), home = join(root, "home"); mkdirSync(home);
  let requests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { requests += 1; return Response.json({}); } });
  try {
    const result = await invoke(server.url.origin, home, "123456\n", ["auth", "keys", "add-publish-scope", "bad/key", "--expected-scopes", "skills:read", "--email", "owner@example.test", "--code-stdin", "--user-id", userId, "--membership-id", membershipId, "--organization-id", organizationId, "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("Invalid API key id");
    expect(requests).toBe(0);
  } finally { await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test("ephemeral scope CLI rejects malformed stdin before any network request", async () => {
  const root = mkdtempSync(join(scratch, "malformed-")), home = join(root, "home"); mkdirSync(home);
  let requests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { requests += 1; return Response.json({}); } });
  try {
    const result = await invoke(server.url.origin, home, "not-an-otp\n", ["auth", "keys", "add-publish-scope", "key_target", "--expected-scopes", "skills:read", "--email", "owner@example.test", "--code-stdin", "--user-id", userId, "--membership-id", membershipId, "--organization-id", organizationId, "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("six-digit");
    expect(requests).toBe(0);
    expect(existsSync(join(home, ".hasna"))).toBe(false);
  } finally { await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});
