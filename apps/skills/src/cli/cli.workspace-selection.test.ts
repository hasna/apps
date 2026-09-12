import { test, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { realpathSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAuthFilePath } from "../lib/auth-store.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const entry = resolve(import.meta.dir, "index.tsx");
test("real CLI discovers safely and refuses to enroll a workspace key: this CLI stores no credentials", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "skills-cli-workspace-")));
  const uid = randomUUID(), a = randomUUID(), b = randomUUID(), oa = randomUUID(), ob = randomUUID();
  const jwtA = randomUUID(), jwtB = randomUUID(), key = `sk_${randomUUID()}`;
  const calls: Array<{ method: string; path: string }> = [];
  const identity = (target: string, authMethod: string) => ({ authMethod,
    user: { id: uid, membershipId: target === "b" ? b : a, email: "owned@example.test", displayName: null, role: "owner" },
    organization: { id: target === "b" ? ob : oa, slug: target, name: target.toUpperCase() } });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname, token = req.headers.get("authorization")?.slice(7), target = [jwtB, key].includes(token!) ? "b" : "a";
    calls.push({ method: req.method, path });
    if (path === "/api/auth/verify") return Response.json({ token: jwtA, user: { id: uid }, firstLogin: false });
    if (path === "/api/auth/whoami") return Response.json(identity(target, token === key ? "api_key" : "jwt"));
    if (path === "/api/v1/account/workspaces") return Response.json({ workspaces: ["a", "b"].map(t => ({ membershipId: t === "b" ? b : a, organization: identity(t,"jwt").organization, role: "owner", current: t === "a" })) });
    if (path === "/api/v1/account/workspaces/switch") return Response.json({ ...identity("b", "jwt"), token: jwtB });
    if (path === "/api/auth/keys") return Response.json({ key });
    return new Response("", { status: 404 });
  } });
  const env = { PATH: process.env.PATH!, HOME: home, HASNA_HOME: join(home,"fleet"), HASNA_PROFILE: "team-b", HASNA_SKILLS_API_URL: server.url.origin, NO_COLOR: "1" };
  async function cli(args: string[], code = "123456\n") {
    const process = Bun.spawn([Bun.env.BUN_BINARY ?? globalThis.process.execPath, entry, ...args], { cwd: home, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    process.stdin.write(code); process.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    for (const secret of [key, jwtA, jwtB, "123456"]) { expect(stdout).not.toContain(secret); expect(stderr).not.toContain(secret); }
    return { stdout, stderr, exitCode };
  }
  try {
    // Discovery is read-only and still works.
    const list = await cli(["workspace","list","--email","owned@example.test","--code-stdin","--json"]);
    expect(list.exitCode, list.stdout + list.stderr).toBe(0); expect(JSON.parse(list.stdout).workspaces).toHaveLength(2);
    expect(existsSync(getAuthFilePath(env))).toBe(false); expect(calls.some(c=>c.path==="/api/auth/keys")).toBe(false);

    // Enrollment used to switch workspace, mint a key and write the profile file.
    // It now stops BEFORE any request (no code consumed, no key minted) and names
    // the profile file the key belongs in (fail-closed re-cut, hasna/apps#1720).
    const before = calls.length;
    const login = await cli(["auth","login","--membership-id",b,"--email","owned@example.test","--code-stdin","--json"]);
    expect(login.exitCode).toBe(1);
    const payload = JSON.parse(login.stdout);
    expect(payload).toMatchObject({ status: "credential_store_unmanaged", code: "CREDENTIAL_STORE_UNMANAGED", profile: "team-b", membershipId: b, apiUrl: server.url.origin, credentialsFile: getAuthFilePath(env) });
    expect(payload.error).toContain("HASNA_SKILLS_API_KEY=<key>");
    expect(calls.slice(before)).toEqual([]);
    expect(existsSync(getAuthFilePath(env))).toBe(false);
  } finally { server.stop(true); rmSync(home,{recursive:true,force:true}); }
}, 30000);
