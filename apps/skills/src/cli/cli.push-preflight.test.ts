import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const scratch = mkdtempSync(join(tmpdir(), "skills-push-preflight-"));
const installed = process.env.SKILLS_PUSH_PREFLIGHT_TEST_PACKAGE;
const binary = installed ? join(installed, "bin/index.js") : join(scratch, "skills.js");
beforeAll(async () => { if (!installed) await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); }, 30_000);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function snapshot(path: string): unknown {
  const stat = lstatSync(path);
  if (stat.isDirectory()) return [stat.mode, stat.ino, stat.mtimeMs, readdirSync(path).sort().map(name => [name, snapshot(join(path, name))])];
  if (!stat.isFile()) throw Error("Unexpected fixture entry");
  return [stat.mode, stat.ino, stat.mtimeMs, createHash("sha256").update(readFileSync(path)).digest("hex")];
}
async function boundedChild(command: string[], env: Record<string, string>, cwd: string) {
  const child = Bun.spawn(command, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const pid = child.pid;
  let timedOut = false, truncated = false, capturedBytes = 0;
  const stop = () => { if (child.exitCode === null) child.kill("SIGKILL"); };
  const timer = setTimeout(() => { timedOut = true; stop(); }, 10_000);
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      const remaining = 30_000 - capturedBytes, kept = chunk.subarray(0, remaining);
      chunks.push(kept); capturedBytes += kept.length;
      if (chunk.length > remaining) { truncated = true; stop(); break; }
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  try {
    const [stdout, stderr, exitCode] = await Promise.all([read(child.stdout), read(child.stderr), child.exited]);
    return { stdout, stderr, exitCode, timedOut, truncated, capturedBytes, pid };
  } finally { clearTimeout(timer); stop(); await child.exited; }
}

test("the actual child reader stops and joins output exceeding its 30KB shared capture budget", async () => {
  const home = mkdtempSync(join(scratch, "capture-"));
  try {
    const result = await boundedChild([process.execPath, "--no-env-file", "-e", "process.stdout.write('x'.repeat(40000));setInterval(()=>{},1000)"], { HOME: home, PATH: "", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, home);
    expect(result.truncated).toBe(true); expect(result.timedOut).toBe(false); expect(result.capturedBytes).toBe(30_000);
    expect(Buffer.byteLength(result.stdout + result.stderr)).toBe(30_000);
    let gone = false; try { process.kill(result.pid, 0); } catch (error) { gone = (error as NodeJS.ErrnoException).code === "ESRCH"; }
    expect(gone).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 15_000);

const refusals = ["500", "403", "401", "generic404", "wrong-domain404", "405", "204", "invalid-json", "null", "array",
  "missing-revision", "empty-revision", "blank-revision", "trimmed-revision", "numeric-revision", "control-revision", "unicode-revision", "wrong-slug", "missing-slug", "transport",
  "catalogue-missing-revision", "catalogue-nonnull-revision", "catalogue-wrong-name", "catalogue-wrong-slug", "catalogue-missing-name", "catalogue-null-name"] as const;
type Mode = typeof refusals[number] | "current" | "domain404" | "nested-domain404" | "bump" | "bump-conflict" | "catalogue" | "catalogue-slug";
async function fixture(mode: Mode, action: (invoke: (human?: boolean, force?: boolean) => Promise<{ stdout: string; stderr: string; exitCode: number }>, calls: Array<{ method: string; path: string; ifMatch: string | null; version?: string }>) => Promise<void>) {
  const root = mkdtempSync(join(scratch, "owned-")), home = join(root, "home"), project = join(root, "project"), data = join(root, "data"), corpus = join(data, "skills"), skill = join(corpus, "preflight-owned");
  for (const path of [home, project, skill, join(root, "tmp"), join(root, "empty-path"), join(root, "empty-source")]) mkdirSync(path, { recursive: true });
  writeFileSync(join(corpus, ".layout-migration.json"), "{}\n");
  writeFileSync(join(skill, "SKILL.md"), "---\nname: preflight-owned\ndescription: Owned preflight fixture\nversion: 1.2.3\nkind: instruction\n---\n# Owned instructions\n");
  writeFileSync(join(skill, "package.json"), JSON.stringify({ name: "preflight-owned", version: "1.2.3" }));
  writeFileSync(join(home, "keep.txt"), "Preserve owned HOME\n"); writeFileSync(join(project, "keep.txt"), "Preserve owned project\n");
  const token = randomUUID(), canary = randomUUID(), guard = join(root, "guard.js"), native = join(root, "native.jsonl"), ready = join(root, "ready");
  const revision = "original-revision_A.1", calls: Array<{ method: string; path: string; ifMatch: string | null; version?: string }> = [], sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    const row = { method: request.method ?? "", path: request.url ?? "", ifMatch: typeof request.headers["if-match"] === "string" ? request.headers["if-match"] : null };
    calls.push(row);
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401); response.end(); return; }
    if (request.method === "GET") {
      if (mode === "transport") { request.socket.destroy(); return; }
      const status = /^\d+$/.test(mode) ? Number(mode) : mode.includes("404") ? 404 : 200;
      let body: unknown = { slug: "preflight-owned", revisionId: revision, extra: canary };
      if (mode === "domain404") body = { code: "SKILL_NOT_FOUND", error: canary };
      else if (mode === "nested-domain404") body = { error: { code: "SKILL_NOT_FOUND", message: canary } };
      else if (mode === "wrong-domain404") body = { code: "NOT_FOUND", error: canary };
      else if (mode === "generic404") body = { error: canary };
      else if (mode === "null") body = null;
      else if (mode === "array") body = [{ slug: "preflight-owned", revisionId: revision }];
      else if (mode === "missing-revision") body = { slug: "preflight-owned" };
      else if (mode === "missing-slug") body = { revisionId: revision };
      else if (mode === "wrong-slug") body = { slug: "unrelated", revisionId: revision };
      else if (mode.startsWith("catalogue")) {
        body = { name: "preflight-owned", publicationState: "catalogue-only", revisionId: null,
          ...(mode === "catalogue-slug" ? { slug: "preflight-owned" } : {}),
          ...(mode === "catalogue-missing-revision" ? { revisionId: undefined } : {}),
          ...(mode === "catalogue-nonnull-revision" ? { slug: "preflight-owned", revisionId: revision } : {}),
          ...(mode === "catalogue-wrong-name" ? { name: "unrelated" } : {}),
          ...(mode === "catalogue-wrong-slug" ? { slug: "unrelated" } : {}),
          ...(mode === "catalogue-missing-name" ? { name: undefined } : {}),
          ...(mode === "catalogue-null-name" ? { name: null } : {}) };
      }
      else if (mode.endsWith("-revision")) body = { slug: "preflight-owned", revisionId: ({ "empty-revision": "", "blank-revision": " \t", "trimmed-revision": " revision ", "numeric-revision": 12, "control-revision": "bad\r\nheader", "unicode-revision": "rev-林" } as Record<string, unknown>)[mode] };
      response.writeHead(status, { "content-type": "application/json" }); response.end(status === 204 ? undefined : mode === "invalid-json" ? `{${canary}` : JSON.stringify(body)); return;
    }
    if (request.method !== "POST") { response.writeHead(405); response.end(); return; }
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers["content-type"]! } }).formData();
      const manifest = JSON.parse(String(form.get("manifest"))); (row as typeof calls[number]).version = manifest.version;
      const posts = calls.filter(call => call.method === "POST").length;
      if (mode.startsWith("bump") && posts === 1) { response.writeHead(409, { "content-type": "application/json" }); response.end(JSON.stringify({ code: "SKILL_VERSION_EXISTS", error: "Owned version conflict" })); return; }
      if (mode === "bump-conflict") { response.writeHead(409, { "content-type": "application/json" }); response.end(JSON.stringify({ code: "REVISION_CONFLICT", error: "Owned changed revision" })); return; }
      response.writeHead(201, { "content-type": "application/json" }); response.end(JSON.stringify({ slug: "preflight-owned", version: manifest.version }));
    } catch { response.writeHead(400); response.end("Owned multipart refused"); }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolveReady, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveReady); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("Owned fixture did not listen");
  const origin = `http://127.0.0.1:${address.port}`;
  writeFileSync(guard, `import{appendFileSync,unlinkSync}from'node:fs';import cp from'node:child_process';import{syncBuiltinESMExports}from'node:module';
try{unlinkSync(process.env.QA_NATIVE)}catch(e){if(e.code!=='ENOENT')throw e}
const previous=globalThis.fetch;globalThis.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!==process.env.QA_ORIGIN)throw Error('PREFLIGHT_NETWORK_REFUSED');return previous(input,{...init,redirect:'error'})};
const deny=(input,args)=>{const cmd=Array.isArray(input)?input:input&&typeof input==='object'?input.cmd:[input,...(Array.isArray(args)?args:[])];if(Array.isArray(cmd)&&cmd[0]==='git'&&cmd[1]==='-C'&&cmd[2]===process.env.QA_SKILL&&[JSON.stringify(['remote','get-url','origin']),JSON.stringify(['rev-parse','HEAD'])].includes(JSON.stringify(cmd.slice(3)))){appendFileSync(process.env.QA_NATIVE,JSON.stringify({git:cmd.slice(3)})+'\\n');throw Error('PREFLIGHT_GIT_REFUSED')}throw Error('PREFLIGHT_NATIVE_REFUSED')};
Bun.spawn=deny;Bun.spawnSync=deny;for(const n of['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[n]=deny;syncBuiltinESMExports();
for(const[op,message]of[[()=>fetch('http://127.0.0.1:1'),'PREFLIGHT_NETWORK_REFUSED'],[()=>Bun.spawn(['/usr/bin/false']),'PREFLIGHT_NATIVE_REFUSED'],[()=>cp.execFileSync('/usr/bin/false'),'PREFLIGHT_NATIVE_REFUSED']]){let ok=false;try{await op()}catch(e){ok=e.message===message}if(!ok)throw Error('PREFLIGHT_GUARD_CONTROL_FAILED')}appendFileSync(process.env.QA_READY,'controls-passed\\n');\n`);
  const env = { HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"), HASNA_DATA_HOME: join(home, "data"), HASNA_STATE_HOME: join(home, "state"), HASNA_CACHE_HOME: join(home, "cache"),
    XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, "data"), XDG_STATE_HOME: join(home, "state"), XDG_CACHE_HOME: join(home, "cache"), HASNA_SKILLS_DIR: data, SKILLS_DATA_DIR: data,
    HASNA_PROFILE: "preflight-fixture", HASNA_STATION: "preflight-fixture", HASNA_SKILLS_API_KEY_OVERRIDE: token, HASNA_SKILLS_API_KEY: token, SKILLS_API_KEY: token,
    HASNA_SKILLS_API_URL: origin + "/prefix", SKILLS_API_URL: origin + "/prefix", QA_ORIGIN: origin, QA_SKILL: skill, QA_NATIVE: native, QA_READY: ready,
    PATH: join(root, "empty-path"), TMPDIR: join(root, "tmp"), SKILLS_SOURCE: join(root, "empty-source"), NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  const before = [snapshot(home), snapshot(project), snapshot(data)];
  try {
    await action(async (human = false, force = false) => {
      const result = await boundedChild([process.execPath, "--no-env-file", "--preload", guard, binary, "push", "preflight-owned", ...(mode.startsWith("bump") || force ? ["--force-new-version"] : []), ...(human ? [] : ["--json"])], env, project);
      const { stdout, stderr } = result;
      expect(result.timedOut).toBe(false); expect(result.truncated).toBe(false);
      expect(stdout + stderr).not.toContain(token); expect(stdout + stderr).not.toContain(canary);
      expect([snapshot(home), snapshot(project), snapshot(data)]).toEqual(before);
      expect(readFileSync(ready, "utf8")).toBe("controls-passed\n");
      expect(readFileSync(native, "utf8").trim().split("\n").map(line => JSON.parse(line))).toEqual([{ git: ["remote", "get-url", "origin"] }, { git: ["rev-parse", "HEAD"] }]);
      return result;
    }, calls);
  } finally {
    for (const socket of sockets) socket.destroy(); await new Promise<void>(resolveClosed => server.close(() => resolveClosed()));
    rmSync(root, { recursive: true, force: true }); expect(existsSync(root)).toBe(false);
  }
}

for (const mode of refusals) test(`actual push refuses ${mode} revision preflight before any upload`, () => fixture(mode, async (invoke, calls) => {
  const result = await invoke(); expect(result.exitCode).toBe(1); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).error).toContain("Publishing was refused because");
  expect(calls).toEqual([{ method: "GET", path: "/prefix/api/v1/skills/preflight-owned", ifMatch: null }]);
}), 15_000);
for (const mode of ["500", "generic404", "missing-revision"] as const) test(`human push reports actionable ${mode} preflight refusal`, () => fixture(mode, async (invoke, calls) => {
  const result = await invoke(true); expect(result.exitCode).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toContain("Publishing was refused because");
  expect(calls.map(call => call.method)).toEqual(["GET"]);
}), 15_000);
for (const mode of ["current", "domain404", "nested-domain404", "bump", "bump-conflict", "catalogue", "catalogue-slug"] as const) test(`actual push preserves proven ${mode} revision semantics`, () => fixture(mode, async (invoke, calls) => {
  const result = await invoke(), conflict = mode === "bump-conflict"; expect(result.exitCode).toBe(conflict ? 1 : 0); expect(result.stderr).toBe("");
  const value = JSON.parse(result.stdout);
  if (conflict) expect(value.error).toContain("NEWER revision"); else { expect(value.published).toBe(true); expect(value.version).toBe(mode === "bump" ? "1.2.4" : "1.2.3"); }
  const ifMatch = mode.includes("404") || mode.startsWith("catalogue") ? null : "original-revision_A.1";
  expect(calls).toEqual([{ method: "GET", path: "/prefix/api/v1/skills/preflight-owned", ifMatch: null },
    { method: "POST", path: "/prefix/api/v1/skills", ifMatch, version: "1.2.3" },
    ...(mode.startsWith("bump") ? [{ method: "POST", path: "/prefix/api/v1/skills", ifMatch, version: "1.2.4" }] : [])]);
}), 15_000);

test("force-new-version cannot bypass a failed revision preflight", () => fixture("500", async (invoke, calls) => {
  const result = await invoke(false, true); expect(result.exitCode).toBe(1); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).error).toContain("current skill lookup failed: HTTP 500");
  expect(calls).toEqual([{ method: "GET", path: "/prefix/api/v1/skills/preflight-owned", ifMatch: null }]);
}), 15_000);
