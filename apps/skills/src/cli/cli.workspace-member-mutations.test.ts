import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

const scratch = mkdtempSync(join(tmpdir(), "skills-member-actions-"));
const binary = join(scratch, "skills.js"), mcp = join(scratch, "mcp.js"), guard = join(scratch, "guard.js");
const actorId=randomUUID(),actorMid=randomUUID();
const code = "132465", session = randomUUID(), durable = randomUUID(), ignoredKey = randomUUID();
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  await buildCliFixture(resolve(import.meta.dir, "../mcp/index.ts"), mcp);
  writeFileSync(guard, `import cp from'node:child_process';import{syncBuiltinESMExports}from'node:module';const deny=()=>{throw Error('OWNED_MEMBER_GUARD')};const f=fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.protocol!=='data:'&&u.origin!==process.env.QA_ALLOWED_ORIGIN)return Promise.reject(Error('OWNED_MEMBER_GUARD'));return f(input,init)};Bun.spawn=deny;Bun.spawnSync=deny;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;syncBuiltinESMExports();`);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function state(root: string): unknown {
  const s = lstatSync(root);
  return [s.mode, s.ino, s.mtimeMs, s.isDirectory() ? readdirSync(root).sort().map(name => [name, state(join(root, name))]) : createHash("sha256").update(readFileSync(root)).digest("hex")];
}
function environment(root: string, origin: string) {
  for (const name of ["home", "hasna", "config", "data", "project"]) mkdirSync(join(root, name), { mode: 0o700 });
  mkdirSync(join(root, "config/skills"));
  for (const name of ["credentials", "credentials-selected", "credentials-unrelated"])
    writeFileSync(join(root, "config/skills", name), `HASNA_SKILLS_API_KEY=${durable}\nHASNA_SKILLS_API_URL=${name === "credentials-selected" ? origin : "http://127.0.0.1:1/unselected"}\n`, { mode: 0o600 });
  writeFileSync(join(root, "config/skills/identity-selected.json"), JSON.stringify({ userId: actorId }), { mode: 0o600 });
  writeFileSync(join(root, "project/keep.txt"), "owned caller content");
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(root, "home"), HASNA_HOME: join(root, "hasna"),
    HASNA_CONFIG_HOME: join(root, "config"), HASNA_SKILLS_DIR: join(root, "data"), HASNA_PROFILE: "selected", TMPDIR: scratch,
    NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", SKILLS_TEST_MODE: "1", QA_ALLOWED_ORIGIN: new URL(origin).origin };
}
type Call = { path: string; method: string; body: unknown; authorized: boolean };
type Reply = { status?: number; body: unknown; raw?: boolean };
async function fixture(action: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup(); try { await action(f); } finally {
    await f.server.stop(true);
    try { expect(state(f.root)).toEqual(f.before); } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
}
async function setup() {
  const root = mkdtempSync(join(scratch, "owned-")), calls: Call[] = [];
  const member = { membershipId: randomUUID(), userId: randomUUID(), email: "member@example.test", displayName: "Ana 林", role: "viewer", createdAt: "2026-09-07T00:00:00.123456Z" };
  const changed = { organizationId: randomUUID(), member, changed: true };
  const removed = { organizationId: changed.organizationId, membershipId: member.membershipId, removed: true, alreadyRemoved: false };
  let reply: Reply = { body: changed };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname + new URL(request.url).search, body = request.method === "GET" ? {} : await request.json() as { email?: string; code?: string; membershipId?: string };
    const authorized = [session,durable].some(value=>request.headers.get("authorization") === `Bearer ${value}`);
    calls.push({ path, method: request.method, body, authorized });
    const identity={user:{id:actorId,membershipId:actorMid,email:"owner@example.test",displayName:null,role:"owner"},organization:{id:changed.organizationId,slug:"selected",name:"Selected"}};
    if(path==="/prefix/api/auth/whoami")return Response.json({...identity,authMethod:request.headers.get("authorization")===`Bearer ${durable}`?"api_key":"jwt"});
    if(path==="/prefix/api/v1/account/workspaces/switch"){expect(body).toEqual({membershipId:actorMid});return Response.json({...identity,token:session});}
    if (path === "/prefix/api/auth/verify") return body.email === "owner@example.test" && body.code === code
      ? Response.json({ token: session, apiKey: ignoredKey, user:{id:actorId} }) : Response.json({ error: durable }, { status: 401 });
    if (path !== `/prefix/api/v1/workspace/members/${member.membershipId}` || !["PATCH", "DELETE"].includes(request.method)) return Response.json({ error: durable }, { status: 404 });
    if (!authorized) return Response.json({ error: durable }, { status: 403 });
    return reply.raw ? new Response(String(reply.body), { status: reply.status ?? 200 }) : Response.json(reply.body, { status: reply.status ?? 200 });
  } });
  const env = environment(root, `${server.url.origin}/prefix/api/v1`), before = state(root);
  return { root, env, before, server, calls, member, changed, removed, reply(value: Reply) { reply = value; } };
}
function noCanaries(text: string) { for (const value of [code, session, durable, ignoredKey]) expect(text).not.toContain(value); }
async function run(root: string, env: Record<string, string>, args: string[], input = code) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, ...args], { cwd: join(root, "project"), env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  let expired = false, bytes = 0;
  const timeout = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 10_000);
  async function capture(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader(), decoder = new TextDecoder(); let output = "";
    try { while (true) {
      const next = await reader.read(); if (next.done) return output + decoder.decode();
      bytes += next.value.byteLength;
      if (bytes > 30_000) { child.kill("SIGKILL"); throw new Error("Owned member child output exceeded limit"); }
      output += decoder.decode(next.value, { stream: true });
    } } finally { reader.releaseLock(); }
  }
  const stdoutDone = capture(child.stdout), stderrDone = capture(child.stderr);
  try {
    child.stdin.write(input + "\n"); await child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([stdoutDone, stderrDone, child.exited]);
    expect(expired).toBe(false); return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timeout); if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
    await Promise.allSettled([stdoutDone, stderrDone]);
  }
}

test("member invocation actively proves HTTP, Bun and Node guards plus bounded output cleanup", async () => fixture(async f => {
  const result = await run(f.root, f.env, ["-e", `import{execFileSync}from'node:child_process';let n=0;for(const call of[()=>fetch('http://127.0.0.1:1/control'),()=>Bun.spawn([process.execPath,'-e','']),()=>execFileSync('/usr/bin/true')]){try{await call()}catch(e){if(e.message==='OWNED_MEMBER_GUARD')n++}}console.log(n);if(n!==3)process.exitCode=1`]);
  expect(result.exitCode).toBe(0); expect(result.stdout.trim()).toBe("3"); expect(f.calls).toEqual([]);
  await expect(run(f.root, f.env, ["-e", "process.stdout.write('x'.repeat(30_001))"])).rejects.toThrow("output exceeded limit");
}));

test("built member CLI preserves explicit preconditions and truthful changed/replayed results in both formats", async () => fixture(async f => {
  for (const action of ["role", "remove"] as const) for (const replay of [false, true]) for (const json of [false, true]) {
    const expected = action === "role" ? { ...f.changed, changed: !replay } : { ...f.removed, alreadyRemoved: replay };
    f.reply({ body: { ...expected, privateCanary: durable } }); const before = f.calls.length;
    const args = [binary, "--profile", "selected", "workspace", "member", action, f.member.membershipId,
      "--expected-role", "member", "--email", "owner@example.test", "--code-stdin", ...(action === "role" ? ["--role", "viewer"] : []), ...(json ? ["--json"] : [])];
    const result = await run(f.root, f.env, args); expect(result.exitCode).toBe(0); noCanaries(result.stdout + result.stderr);
    if (json) expect(JSON.parse(result.stdout)).toEqual(expected);
    else expect(result.stdout).toContain(action === "role" ? (replay ? "already has role viewer" : "changed to viewer") : (replay ? "already removed" : "Membership removed"));
    expect(f.calls.slice(before).map(call => [call.path, call.method, call.authorized])).toEqual([
      ["/prefix/api/auth/whoami", "GET", true], ["/prefix/api/auth/verify", "POST", false], ["/prefix/api/auth/whoami", "GET", true], ["/prefix/api/v1/account/workspaces/switch", "POST", true], ["/prefix/api/auth/whoami", "GET", true], [`/prefix/api/v1/workspace/members/${f.member.membershipId}`, action === "role" ? "PATCH" : "DELETE", true]]);
    expect(f.calls.at(-1)?.body).toEqual(action === "role" ? { role: "viewer", expectedRole: "member" } : { expectedRole: "member" });
    expect(state(f.root)).toEqual(f.before);
  }
}));

test("built member CLI refuses unsafe inputs before verification and never hides remote refusals", async () => fixture(async f => {
  const common = [binary, "workspace", "member", "role", f.member.membershipId, "--email", "owner@example.test", "--code-stdin", "--role", "viewer", "--expected-role", "member"];
  for (const args of [common.filter((_, i) => i < common.length - 2), [...common, "--organization-id", randomUUID()], [...common, "extra"],
    common.map(x => x === "viewer" ? "superuser" : x), common.map(x => x === f.member.membershipId ? "bad" : x), common.filter(x => x !== "--code-stdin")]) {
    const result = await run(f.root, f.env, [...args, "--json"]); expect(result.exitCode).toBe(1); noCanaries(result.stdout + result.stderr); expect(f.calls).toEqual([]);
  }
  expect((await run(f.root, f.env, common, "invalid")).exitCode).toBe(1); expect(f.calls).toEqual([]);
  expect((await run(f.root, f.env, common, "000000")).exitCode).toBe(1); expect(f.calls).toHaveLength(2);
  for (const [status, errorCode] of [[403, "MEMBERSHIP_ACTION_FORBIDDEN"], [404, "MEMBERSHIP_NOT_FOUND"], [409, "MEMBERSHIP_ROLE_CHANGED"], [409, "LAST_OWNER_REQUIRED"], [503, "MEMBERSHIP_BUSY"], [404, "NOT_FOUND"], [500, "UNKNOWN"]] as const) {
    f.reply({ status, body: { code: errorCode, error: durable } });
    for (const json of [false, true]) {
      const before = f.calls.length, result = await run(f.root, f.env, [...common, ...(json ? ["--json"] : [])]);
      expect(result.exitCode).toBe(1); noCanaries(result.stdout + result.stderr); expect(f.calls).toHaveLength(before + 6);
      if (json) { const body = JSON.parse(result.stdout); expect(body.status).toBe(status); if (!["NOT_FOUND", "UNKNOWN"].includes(errorCode)) expect(body.code).toBe(errorCode); }
      else expect(result.stdout).toBe("");
    }
  }
  for (const body of [{}, { ...f.changed, member: { ...f.member, membershipId: randomUUID() } }, { ...f.changed, changed: "yes" }]) {
    f.reply({ body }); const result = await run(f.root, f.env, [...common, "--json"]); expect(result.exitCode).toBe(1); noCanaries(result.stdout + result.stderr);
  }
}));

test("actual stdio member tools share safe client contracts and preserve credentials through failures", async () => fixture(async f => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", "--preload", guard, mcp, "--stdio"], cwd: join(f.root, "project"), env: f.env, stderr: "pipe" });
  const client = new Client({ name: "owned-member-test", version: "1.0.0" }); let pid: number | null = null, stderr = "", overflow = false;
  let closed = Promise.resolve();
  transport.stderr?.on("data", chunk => { if (stderr.length + chunk.length > 30_000) { overflow = true; if (pid) process.kill(pid, "SIGKILL"); } else stderr += chunk.toString(); });
  try {
    await client.connect(transport); pid = transport.pid; expect(pid).not.toBeNull();
    const previousClose = transport.onclose;
    closed = new Promise<void>(resolveClose => { transport.onclose = () => { previousClose?.(); resolveClose(); }; });
    const tools = (await client.listTools()).tools;
    for (const name of ["set_workspace_member_role", "remove_workspace_member"]) expect(tools.some(tool => tool.name === name)).toBe(true);
    const invoke = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }, undefined, { timeout: 5000 });
    const common = { membershipId: f.member.membershipId, expectedRole: "member", email: "owner@example.test", code };
    for (const action of ["role", "remove"] as const) {
      const name = action === "role" ? "set_workspace_member_role" : "remove_workspace_member", args = action === "role" ? { ...common, role: "viewer" } : common;
      for (const replay of [false, true]) {
        const expected = action === "role" ? { ...f.changed, changed: !replay } : { ...f.removed, alreadyRemoved: replay };
        f.reply({ body: expected }); const before = f.calls.length, result = await invoke(name, args);
        expect(result.isError).not.toBe(true); noCanaries(JSON.stringify(result)); expect(f.calls).toHaveLength(before + 6);
        expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual(expected);
      }
      for (const invalid of [{ ...args, expectedRole: undefined }, { ...args, expectedRole: "superuser" }, { ...args, organizationId: randomUUID() }]) {
        const before = f.calls.length, result = await invoke(name, invalid); expect(result.isError).toBe(true); expect(f.calls).toHaveLength(before); noCanaries(JSON.stringify(result));
      }
      f.reply({ status: 409, body: { code: "MEMBERSHIP_ROLE_CHANGED", error: durable } });
      const refused = await invoke(name, args); expect(refused.isError).toBe(true); expect(JSON.stringify(refused)).toContain("MEMBERSHIP_ROLE_CHANGED"); noCanaries(JSON.stringify(refused));
      f.reply({ body: { ...f.removed, membershipId: randomUUID() } });
      const malformed = await invoke(name, args); expect(malformed.isError).toBe(true); noCanaries(JSON.stringify(malformed));
    }
  } finally {
    pid ??= transport.pid; await client.close(); await transport.close();
    if (pid !== null) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([closed, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Owned member MCP close was not observed")), 3000); })]); }
      finally { clearTimeout(timeout); }
      expect(() => process.kill(pid!, 0)).toThrow();
    }
    expect(overflow).toBe(false); noCanaries(stderr); expect(state(f.root)).toEqual(f.before);
  }
}));
