import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerRemoteCustomerTools } from "../mcp/remote-customer-tools.js";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

const scratch = mkdtempSync(join(tmpdir(), "skills-customer-names-"));
const binary = join(scratch, "skills.js"), guard = join(scratch, "guard.js");
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  writeFileSync(guard, `const f=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.protocol!=='data:'&&u.origin!==process.env.QA_ALLOWED_ORIGIN)throw Error('network denied');return f(input,init)};`);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const fixtureCode = "132465", session = "ephemeral-name-session-canary", durable = "durable-name-key-canary";
type Call = { path: string; method: string; body: Record<string, unknown>; authorized: boolean };
async function fixture(action: (origin: string, calls: Call[], refuse: () => void) => Promise<void>) {
  const calls: Call[] = [];
  let forbidden = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname, body = await req.json() as Record<string, unknown>;
    calls.push({ path, method: req.method, body, authorized: req.headers.get("authorization") === `Bearer ${session}` });
    if (path.endsWith("/login")) return Response.json({ sent: true });
    if (path.endsWith("/verify")) {
      if (body.code !== fixtureCode || body.email !== "names@example.test") return Response.json({ error: session }, { status: 401 });
      return Response.json({ token: session, apiKey: "unexpected-one-time-fixture-key" });
    }
    if (forbidden || req.headers.get("authorization") !== `Bearer ${session}`) return Response.json({ error: session }, { status: 403 });
    return Response.json(path.endsWith("/profile")
      ? { user: { id: "user", email: "names@example.test", displayName: body.displayName, role: "owner" } }
      : { organization: { id: "workspace", slug: "stable", name: body.name } });
  } });
  try { await action(`${server.url.origin}/prefix/api/v1`, calls, () => { forbidden = true; }); }
  finally { await server.stop(true); }
}
function state(root: string): unknown {
  return readdirSync(root).sort().map(name => {
    const path = join(root, name), stat = lstatSync(path);
    return stat.isDirectory() ? [name, state(path)] : [name, stat.mode, createHash("sha256").update(readFileSync(path)).digest("hex")];
  });
}
function environment(root: string, origin: string) {
  const config = join(root, "config"); mkdirSync(join(config, "skills"), { recursive: true });
  writeFileSync(join(config, "skills", "credentials"), `HASNA_SKILLS_API_KEY=${durable}\n`, { mode: 0o600 });
  writeFileSync(join(config, "skills", "identity.json"), JSON.stringify({ userId: "preserved", orgId: "preserved" }), { mode: 0o600 });
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(root, "home"), TMPDIR: scratch, NO_COLOR: "1", TERM: "dumb",
    HASNA_HOME: join(root, "hasna"), HASNA_CONFIG_HOME: config, HASNA_SKILLS_DIR: join(root, "data"),
    HASNA_STATION: "customer-names-owned", HASNA_SKILLS_API_URL: origin, HASNA_SKILLS_API_KEY_OVERRIDE: durable,
    QA_ALLOWED_ORIGIN: new URL(origin).origin, SKILLS_TEST_MODE: "1" };
}
test("built CLI uses stdin OTP, preserves saved credentials and returns nonzero on denied/malformed actions", async () => fixture(async (origin, calls, refuse) => {
  const root = mkdtempSync(join(scratch, "cli-")), env = environment(root, origin);
  const before = state(env.HASNA_CONFIG_HOME);
  async function run(args: string[], code = fixtureCode) {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, ...args], { cwd: root, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write(code + "\n"); await child.stdin.end();
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      for (const canary of [fixtureCode, session, durable, "unexpected-one-time-fixture-key"]) expect(stdout + stderr).not.toContain(canary);
      expect(state(env.HASNA_CONFIG_HOME)).toEqual(before);
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(timeout); }
  }
  const common = ["--email", "names@example.test", "--code-stdin"];
  const profile = await run(["account", "update", "--display-name", "  Ana 林  ", ...common, "--json"]);
  expect(profile.exitCode).toBe(0); expect(JSON.parse(profile.stdout).user.displayName).toBe("Ana 林");
  const workspace = await run(["workspace", "update", "--name", "Studio", ...common]);
  expect(workspace.exitCode).toBe(0); expect(workspace.stdout).toContain("Workspace name saved.");
  expect(calls.map(call => [call.path, call.method, call.authorized])).toEqual([
    ["/prefix/api/auth/verify", "POST", false], ["/prefix/api/v1/account/profile", "PATCH", true],
    ["/prefix/api/auth/verify", "POST", false], ["/prefix/api/v1/workspaces/current", "PATCH", true],
  ]);
  const count = calls.length;
  for (const args of [["account", "update", "--display-name", " ", ...common, "--json"], ["workspace", "update", "--name", "Studio", ...common, "unexpected"]]) {
    expect((await run(args)).exitCode).toBe(1);
  }
  expect((await run(["account", "update", "--display-name", "Ana", ...common, "--json"], "invalid")).exitCode).toBe(1);
  expect((await run(["account", "update", "--display-name", "Ana", "--email", "names@example.test", "--json"])).exitCode).toBe(1);
  expect(calls.length).toBe(count);
  refuse();
  const denied = await run(["workspace", "update", "--name", "Studio", ...common, "--json"]);
  expect(denied.exitCode).toBe(1); expect(JSON.parse(denied.stdout).error).toContain("HTTP 403");
  expect(calls.at(-1)?.authorized).toBe(true);
}));

test("actual PTY requests and masks a fresh code, restores terminal mode, and cancels with130 before verification", async () => fixture(async (origin, calls) => {
  const driver = `import os,pty,select,time,signal,json,sys,termios
c=json.loads(sys.stdin.readline()); pid,fd=pty.fork()
if pid==0: os.execv(c['command'][0],c['command'])
output=b''; acted=False; status=None; restored=False; deadline=time.monotonic()+15
try:
 while time.monotonic()<deadline:
  readable,_,_=select.select([fd],[],[],0.05)
  if readable:
   try: chunk=os.read(fd,65536)
   except OSError: chunk=b''
   output+=chunk
   if not acted and b'Enter the six-digit code sent to your email: ' in output:
    os.write(fd,b'\\x03' if c['cancel'] else c['code'].encode()+b'\\r'); acted=True
  done,value=os.waitpid(pid,os.WNOHANG)
  if done: status=value; break
 if status is None: os.kill(pid,signal.SIGKILL); _,status=os.waitpid(pid,0)
 restored=bool(termios.tcgetattr(fd)[3]&termios.ICANON) and bool(termios.tcgetattr(fd)[3]&termios.ECHO)
finally:
 if status is None:
  try: os.kill(pid,signal.SIGKILL)
  except ProcessLookupError: pass
  _,status=os.waitpid(pid,0)
 os.close(fd)
print(json.dumps({'exitCode':os.waitstatus_to_exitcode(status),'promptSeen':acted,'codeLeaked':c['code'].encode() in output,'masked':b'******' in output,'saved':b'Display name saved.' in output,'terminalRestored':restored}))`;
  for (const cancel of [false, true]) {
    const root = mkdtempSync(join(scratch, "pty-")), env = environment(root, origin), before = state(env.HASNA_CONFIG_HOME);
    const beforeCalls = calls.length;
    const child = Bun.spawn(["python3", "-c", driver], { cwd: root, env, stdin: new Blob([JSON.stringify({ cancel, code: fixtureCode,
      command: [process.execPath, "--no-env-file", "--preload", guard, binary, "account", "update", "--display-name", "PTY Ana", "--email", "names@example.test"] }) + "\n"]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exitCode).toBe(0); expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ exitCode: cancel ? 130 : 0, promptSeen: true, codeLeaked: false, terminalRestored: true,
      ...(cancel ? { saved: false } : { saved: true, masked: true }) });
    expect(calls.slice(beforeCalls).map(call => call.path)).toEqual(cancel ? ["/prefix/api/auth/login"]
      : ["/prefix/api/auth/login", "/prefix/api/auth/verify", "/prefix/api/v1/account/profile"]);
    expect(state(env.HASNA_CONFIG_HOME)).toEqual(before);
  }
}));

test("registered MCP tools share fresh-session authority and return protocol errors without credentials", async () => fixture(async (origin, calls, refuse) => {
  const root = mkdtempSync(join(scratch, "mcp-")), env = environment(root, origin);
  const before = state(env.HASNA_CONFIG_HOME);
  const saved = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const server = new McpServer({ name: "owned-customer-names", version: "1.0.0" });
  registerRemoteCustomerTools(server);
  const client = new Client({ name: "owned-customer-names-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toContain("update_account_profile"); expect(names).toContain("update_workspace_name");
    for (const name of ["update_account_profile", "update_workspace_name"]) {
      const result = await client.callTool({ name, arguments: { name: "MCP Ana 林", email: "names@example.test", code: fixtureCode } });
      expect(result.isError).not.toBe(true);
      for (const canary of [fixtureCode, session, durable]) expect(JSON.stringify(result)).not.toContain(canary);
      expect(calls.at(-1)?.authorized).toBe(true);
    }
    refuse();
    const denied = await client.callTool({ name: "update_workspace_name", arguments: { name: "Attempt", email: "names@example.test", code: fixtureCode } });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain("NAME_UPDATE_FAILED"); expect(JSON.stringify(denied)).not.toContain(session);
    expect(state(env.HASNA_CONFIG_HOME)).toEqual(before);
  } finally {
    await client.close(); await server.close();
    for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}));
