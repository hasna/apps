import { test, expect, spyOn } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, renameSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { saveAuthConfig, getAuthFilePath, getIdentityFilePath } from "./auth-store.js";
import { captureProfileWorkspace, prepareWorkspaceEnrollment } from "./workspace-profile.js";
import { resolveSkillsConnection } from "./fleet-credentials.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

async function fixture(run: (f: any) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), "skills-workspace-profile-"));
  const userId = randomUUID(), a = randomUUID(), b = randomUUID(), orgA = randomUUID(), orgB = randomUUID();
  const keys = { a: `sk_${randomUUID()}`, b: `sk_${randomUUID()}` }, tokens = { a: randomUUID(), b: randomUUID() };
  const calls: string[] = []; let mode = "normal"; let hook = () => {};
  const identity = (target: string, method: string) => ({ authMethod: method,
    user: { id: userId, membershipId: target === "a" ? a : b, email: "user@example.test", displayName: null, role: mode === "viewer" ? "viewer" : "owner" },
    organization: { id: target === "a" ? orgA : orgB, slug: target, name: target.toUpperCase() } });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname; calls.push(`${req.method} ${path}`);
    const bearer = req.headers.get("authorization")?.slice(7);
    const target = bearer === tokens.b || bearer === keys.b ? "b" : "a";
    if (path === "/api/auth/verify") { hook(); return Response.json({ token: tokens.a, user: { id: userId }, firstLogin: false }); }
    if (path === "/api/auth/whoami") return Response.json(identity(mode === "key-mismatch" && bearer === keys.b ? "a" : target, Object.values(keys).includes(bearer!) ? "api_key" : "jwt"));
    if (path === "/api/v1/account/workspaces/switch") {
      expect(await req.json()).toEqual({ membershipId: b });
      return mode === "removed" ? Response.json({ code: "WORKSPACE_UNAVAILABLE" }, { status: 404 }) : Response.json({ ...identity("b", "jwt"), token: tokens.b });
    }
    if (path === "/api/auth/keys") { expect(target).toBe("b"); if (mode === "lost") return Response.json({}, { status: 503 }); return Response.json({ key: keys.b }); }
    return new Response("", { status: 404 });
  } });
  const origin = `http://127.0.0.1:${server.port}`;
  const env = { HOME: home, HASNA_HOME: join(home, "fleet"), HASNA_PROFILE: "target-b", HASNA_SKILLS_API_URL: origin, PATH: process.env.PATH };
  const setup = () => saveAuthConfig({ apiKey: keys.a, userId, email: "user@example.test", orgId: orgA, orgSlug: "a" }, env, origin);
  try { await run({ home, env, a, b, userId, orgA, orgB, keys, tokens, calls, setup, origin, mode: (v: string) => { mode = v; }, hook: (v: () => void) => { hook = v; } }); }
  finally { server.stop(true); rmSync(home, { recursive: true, force: true }); }
}

test("enrollment preserves profiles and captures source environment; key identity proves B", async () => fixture(async f => {
  f.setup();
  const original = readFileSync(getAuthFilePath(f.env), "utf8");
  const other = { ...f.env, HASNA_PROFILE: "untouched" }; saveAuthConfig({ apiKey: f.keys.a }, other, f.origin);
  const sentinel = readFileSync(getAuthFilePath(other), "utf8");
  const enrollment = await prepareWorkspaceEnrollment(f.b, f.env);
  f.env.HASNA_PROFILE = "other-profile";
  const result = await enrollment.complete("user@example.test", "123456");
  expect(result).toMatchObject({ membershipId: f.b, profile: "target-b", keyCreated: true, organizationId: f.orgB });
  expect(JSON.stringify(result)).not.toContain(f.keys.b); expect(JSON.stringify(result)).not.toContain(f.tokens.b);
  const targetEnv = { ...f.env, HASNA_PROFILE: "target-b" };
  expect((await resolveSkillsConnection(targetEnv))?.apiKey).toBe(f.keys.b);
  expect((await captureProfileWorkspace("test", targetEnv)).context).toEqual({ userId: f.userId, membershipId: f.b });
  expect(readFileSync(getAuthFilePath(other), "utf8")).toBe(sentinel);
  expect(readFileSync(getAuthFilePath(targetEnv), "utf8")).not.toBe(original);
  expect(statSync(getAuthFilePath(targetEnv)).mode & 0o777).toBe(0o600);
  expect(statSync(getIdentityFilePath(targetEnv)).mode & 0o777).toBe(0o600);
  expect(f.calls.filter((c: string) => c === "POST /api/auth/keys")).toHaveLength(1);
}));

test("explicit profile and uninjected authority are required before any request", async () => fixture(async f => {
  await expect(prepareWorkspaceEnrollment(f.b, { ...f.env, HASNA_PROFILE: undefined })).rejects.toThrow("explicit HASNA_PROFILE");
  await expect(prepareWorkspaceEnrollment(f.b, { ...f.env, HASNA_SKILLS_API_KEY_OVERRIDE: f.keys.a })).rejects.toThrow("injected");
  await expect(prepareWorkspaceEnrollment("bad-membership", f.env)).rejects.toThrow();
  expect(f.calls).toEqual([]);
}));

test("new named profile can enroll without resolving another profile", async () => fixture(async f => {
  const enrollment = await prepareWorkspaceEnrollment(f.b, f.env);
  await enrollment.complete("user@example.test", "123456");
  expect((await resolveSkillsConnection(f.env))?.apiKey).toBe(f.keys.b);
}));

for (const mode of ["viewer", "removed", "key-mismatch", "lost"]) test(`refuses ${mode} without overwriting the profile or retrying issuance`, async () => fixture(async f => {
  f.setup(); const file = getAuthFilePath(f.env), identity = getIdentityFilePath(f.env);
  const before = readFileSync(file, "utf8"), beforeIdentity = readFileSync(identity, "utf8");
  const enrollment = await prepareWorkspaceEnrollment(f.b, f.env); f.mode(mode);
  await expect(enrollment.complete("user@example.test", "123456")).rejects.toThrow(mode === "lost" || mode === "key-mismatch" ? "issuance was attempted" : mode === "viewer" ? "Viewer" : "Unable to verify");
  expect(readFileSync(file, "utf8")).toBe(before); expect(readFileSync(identity, "utf8")).toBe(beforeIdentity);
  expect(f.calls.filter((c: string) => c === "POST /api/auth/keys")).toHaveLength(mode === "lost" || mode === "key-mismatch" ? 1 : 0);
}));

test("profile changed during OTP refuses before key issuance", async () => fixture(async f => {
  f.setup(); const enrollment = await prepareWorkspaceEnrollment(f.b, f.env);
  f.hook(() => writeFileSync(getIdentityFilePath(f.env), "{}\n", { mode: 0o600 }));
  await expect(enrollment.complete("user@example.test", "123456")).rejects.toThrow();
  expect(f.calls).not.toContain("POST /api/auth/keys");
}));

test("different identity and symlink profile refuse without OTP consumption", async () => fixture(async f => {
  f.setup(); const enrollment = await prepareWorkspaceEnrollment(f.b, f.env); const count = f.calls.length;
  await expect(enrollment.complete("another@example.test", "123456")).rejects.toThrow("another account");
  expect(f.calls).toHaveLength(count);
  const file = getIdentityFilePath(f.env); rmSync(file); symlinkSync(getAuthFilePath(f.env), file);
  await expect(prepareWorkspaceEnrollment(f.b, f.env)).rejects.toThrow();
  expect(existsSync(getAuthFilePath(f.env))).toBe(true);
}));

test("second rename failure restores prior identity and preserves prior key", async () => fixture(async f => {
  f.setup(); const file=getAuthFilePath(f.env), identityFile=getIdentityFilePath(f.env);
  const before=readFileSync(file,"utf8"), metadata=readFileSync(identityFile,"utf8");
  const enrollment=await prepareWorkspaceEnrollment(f.b,f.env);
  const realRename=fs.renameSync; let injected=false;
  const mock=spyOn(fs,"renameSync").mockImplementation((source,target)=>{ if(String(target)===file && !injected){injected=true;throw new Error("owned second rename failure");}return realRename(source,target); });
  try { await expect(enrollment.complete("user@example.test","123456")).rejects.toThrow("issuance was attempted"); }
  finally { mock.mockRestore(); }
  expect(injected).toBe(true);expect(readFileSync(file,"utf8")).toBe(before);expect(readFileSync(identityFile,"utf8")).toBe(metadata);
  expect(f.calls.filter((c:string)=>c==="POST /api/auth/keys")).toHaveLength(1);
}));

test("parent replacement during OTP cannot redirect storage or request a key", async () => fixture(async f => {
  f.setup();const enrollment=await prepareWorkspaceEnrollment(f.b,f.env);const directory=getAuthFilePath(f.env).slice(0,getAuthFilePath(f.env).lastIndexOf("/"));
  f.hook(()=>{ renameSync(directory,directory+"-old");mkdirSync(directory,{mode:0o700}); });
  await expect(enrollment.complete("user@example.test","123456")).rejects.toThrow();
  expect(f.calls).not.toContain("POST /api/auth/keys");expect(existsSync(getAuthFilePath(f.env))).toBe(false);
}));

test("metadata mismatch restricts named profile authority before OTP", async () => fixture(async f => {
  f.setup();const file=getIdentityFilePath(f.env);const value=JSON.parse(readFileSync(file,"utf8"));value.orgId=f.orgB;writeFileSync(file,JSON.stringify(value),{mode:0o600});
  await expect(prepareWorkspaceEnrollment(f.b,f.env)).rejects.toThrow("metadata");
  await expect(captureProfileWorkspace("test",f.env)).rejects.toThrow("metadata");
  expect(f.calls).not.toContain("POST /api/auth/verify");
}));

test("oversized preserved UTF-8 profile refuses before OTP and leaves bytes unchanged", async () => fixture(async f => {
  f.setup(); const file=getAuthFilePath(f.env);const body="#"+"x".repeat(65534);writeFileSync(file,body,{mode:0o600});
  await expect(prepareWorkspaceEnrollment(f.b,f.env)).rejects.toThrow("insufficient space");
  expect(f.calls).toEqual([]);expect(readFileSync(file,"utf8")).toBe(body);
}));

test("bounded UTF-8 comments survive enrollment and saved profile is readable", async () => fixture(async f => {
  f.setup();const file=getAuthFilePath(f.env);const comment="#"+"é".repeat(20000)+"\n";writeFileSync(file,comment+readFileSync(file,"utf8"),{mode:0o600});
  const enrollment=await prepareWorkspaceEnrollment(f.b,f.env);await enrollment.complete("user@example.test","123456");
  expect(readFileSync(file,"utf8").startsWith(comment)).toBe(true);expect(readFileSync(file).length).toBeLessThanOrEqual(65536);
  expect((await resolveSkillsConnection(f.env))?.apiKey).toBe(f.keys.b);
}));
