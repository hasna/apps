import { test, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAuthFilePath } from "../lib/auth-store.js";

const entry = resolve(import.meta.dir, "index.tsx");
test("real CLI discovers safely, enrolls B and keeps the next fresh-auth mutation on B", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-cli-workspace-"));
  const uid = randomUUID(), a = randomUUID(), b = randomUUID(), oa = randomUUID(), ob = randomUUID();
  const jwtA = randomUUID(), jwtB = randomUUID(), key = `sk_${randomUUID()}`;
  const calls: Array<{ method: string; path: string; target: string }> = [];
  const identity = (target: string, authMethod: string) => ({ authMethod,
    user: { id: uid, membershipId: target === "b" ? b : a, email: "owned@example.test", displayName: null, role: "owner" },
    organization: { id: target === "b" ? ob : oa, slug: target, name: target.toUpperCase() } });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname, token = req.headers.get("authorization")?.slice(7), target = [jwtB, key].includes(token!) ? "b" : "a";
    calls.push({ method: req.method, path, target });
    if (path === "/api/auth/verify") return Response.json({ token: jwtA, user: { id: uid }, firstLogin: false });
    if (path === "/api/auth/whoami") return Response.json(identity(target, token === key ? "api_key" : "jwt"));
    if (path === "/api/v1/account/workspaces") return Response.json({ workspaces: ["a", "b"].map(t => ({ membershipId: t === "b" ? b : a, organization: identity(t,"jwt").organization, role: "owner", current: t === "a" })) });
    if (path === "/api/v1/account/workspaces/switch") { expect(await req.json()).toEqual({ membershipId: b }); return Response.json({ ...identity("b", "jwt"), token: jwtB }); }
    if (path === "/api/auth/keys") { expect(target).toBe("b"); return Response.json({ key }); }
    if (path === "/api/v1/workspaces/current" && req.method === "PATCH") { expect(target).toBe("b"); return Response.json({ organization: { ...identity("b", "jwt").organization, name: "Selected Name" } }); }
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
    const list = await cli(["workspace","list","--email","owned@example.test","--code-stdin","--json"]);
    expect(list.exitCode).toBe(0); expect(JSON.parse(list.stdout).workspaces).toHaveLength(2);
    expect(existsSync(getAuthFilePath(env))).toBe(false); expect(calls.some(c=>c.path==="/api/auth/keys")).toBe(false);
    const malformed = await cli(["auth","login","--membership-id",b,"--email","owned@example.test","--code-stdin","--json"], "bad\n");
    expect(malformed.exitCode).toBe(1); expect(existsSync(getAuthFilePath(env))).toBe(false);
    const login = await cli(["auth","login","--membership-id",b,"--email","owned@example.test","--code-stdin","--json"]);
    expect(login.exitCode).toBe(0); expect(JSON.parse(login.stdout)).toMatchObject({ profile: "team-b", membershipId: b, keyCreated: true });
    const stored = readFileSync(getAuthFilePath(env),"utf8"); expect(stored).toContain(key); expect(stored).not.toContain(jwtB);
    const update = await cli(["workspace","update","--name","Selected Name","--email","owned@example.test","--code-stdin","--json"]);
    expect(update.exitCode).toBe(0); expect(JSON.parse(update.stdout).organization.id).toBe(ob);
    expect(readFileSync(getAuthFilePath(env),"utf8")).toBe(stored);
    expect(calls.filter(c=>c.path==="/api/auth/keys")).toHaveLength(1);
    expect(calls.filter(c=>c.method==="PATCH")).toEqual([{ method:"PATCH",path:"/api/v1/workspaces/current",target:"b" }]);
  } finally { server.stop(true); rmSync(home,{recursive:true,force:true}); }
}, 30000);
