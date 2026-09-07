import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

const scratch = mkdtempSync(join(tmpdir(), "skills-versions-response-"));
const binary = join(scratch, "skills.js"), guard = join(scratch, "guard.js");
const invalidResponse = "Remote skill version payload did not match the expected contract.";
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  writeFileSync(guard, `import cp from 'node:child_process';import{syncBuiltinESMExports}from'node:module';const deny=()=>{throw Error('OWNED_VERSIONS_GUARD')};const f=fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.protocol!=='data:'&&u.origin!==process.env.QA_ALLOWED_ORIGIN)return Promise.reject(Error('OWNED_VERSIONS_GUARD'));return f(input,init)};Bun.spawn=deny;Bun.spawnSync=deny;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;syncBuiltinESMExports();`);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function state(root: string): unknown {
  const stat = lstatSync(root);
  return [stat.mode, stat.ino, stat.mtimeMs, stat.isDirectory()
    ? readdirSync(root).sort().map(name => [name, state(join(root, name))])
    : createHash("sha256").update(readFileSync(root)).digest("hex")];
}
async function run(root: string, env: Record<string, string>, args: string[]) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, ...args], {
    cwd: join(root, "project"), env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  let expired = false;
  const deadline = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 10_000);
  let outputBytes = 0;
  async function capture(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader(), decoder = new TextDecoder(); let text = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return text + decoder.decode();
        outputBytes += value.byteLength;
        if (outputBytes > 30_000) { child.kill("SIGKILL"); throw Error("Owned versions child output exceeded limit"); }
        text += decoder.decode(value, { stream: true });
      }
    } finally { reader.releaseLock(); }
  }
  const stdoutDone = capture(child.stdout), stderrDone = capture(child.stderr);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([stdoutDone, stderrDone, child.exited]);
    expect(expired).toBe(false);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
    await Promise.allSettled([stdoutDone, stderrDone]);
  }
}
type Reply = { body: unknown; status?: number; raw?: boolean };
async function fixture(action: (invoke: (response: Reply, json: boolean) => Promise<Awaited<ReturnType<typeof run>>>) => Promise<void>, control = false) {
  const root = mkdtempSync(join(scratch, "owned-")), token = randomUUID(), preserved = randomUUID();
  for (const name of ["home", "hasna", "config", "data", "project"]) mkdirSync(join(root, name), { mode: 0o700 });
  mkdirSync(join(root, "config/skills"));
  for (const name of ["credentials", "credentials-selected", "credentials-unrelated"])
    writeFileSync(join(root, "config/skills", name), `HASNA_SKILLS_API_KEY=${preserved}\nHASNA_SKILLS_API_URL=http://127.0.0.1:1/unselected\n`, { mode: 0o600 });
  writeFileSync(join(root, "project/keep.txt"), "owned project data");
  let reply: Reply = { body: { versions: [] } }, calls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    calls++;
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/prefix/api/v1/skills/owned-version/versions");
    expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
    return reply.raw ? new Response(String(reply.body), { status: reply.status ?? 200 })
      : Response.json(reply.body, { status: reply.status ?? 200 });
  } });
  const env = { PATH: "", HOME: join(root, "home"), HASNA_HOME: join(root, "hasna"), HASNA_CONFIG_HOME: join(root, "config"),
    HASNA_SKILLS_DIR: join(root, "data"), HASNA_PROFILE: "selected", HASNA_SKILLS_API_KEY_OVERRIDE: token,
    HASNA_SKILLS_API_URL: `${server.url.origin}/prefix`, TMPDIR: scratch, NO_COLOR: "1", TERM: "dumb",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", QA_ALLOWED_ORIGIN: server.url.origin };
  const before = state(root);
  try {
    if (control) {
      const result = await run(root, env, ["-e", `import{execFileSync}from'node:child_process';let count=0;for(const call of[()=>fetch('http://127.0.0.1:1/control'),()=>Bun.spawn([process.execPath,'-e','']),()=>execFileSync('/usr/bin/true')]){try{await call()}catch(e){if(e.message==='OWNED_VERSIONS_GUARD')count++}}console.log(count);if(count!==3)process.exitCode=1`]);
      expect(result.exitCode).toBe(0); expect(result.stdout.trim()).toBe("3"); expect(calls).toBe(0);
      await expect(run(root, env, ["-e", "process.stdout.write('x'.repeat(30_001))"])).rejects.toThrow("Owned versions child output exceeded limit");
    } else await action(async (response, json) => {
      reply = response; const count = calls;
      const result = await run(root, env, [binary, "versions", "owned-version", ...(json ? ["--json"] : [])]);
      expect(calls).toBe(count + 1);
      for (const key of [token, preserved]) expect(result.stdout + result.stderr).not.toContain(key);
      expect(state(root)).toEqual(before);
      return result;
    });
  } finally {
    await server.stop(true);
    try { expect(state(root)).toEqual(before); }
    finally { rmSync(root, { recursive: true, force: true }); }
  }
}
const row = () => ({ slug: "owned-version", version: "2.0.0", bundleSha256: "a".repeat(64), bundleByteSize: 42,
  createdAt: "2026-09-07T00:00:00.123456Z", current: true });

test("versions child invocation loads HTTP and native-denial guards", async () => fixture(async () => {}, true));

test("built versions CLI preserves populated history, true empty history and domain absence in both formats", async () => fixture(async invoke => {
  for (const json of [false, true]) {
    const valid = row(), populated = await invoke({ body: { versions: [valid] } }, json);
    expect(populated.exitCode).toBe(0);
    if (json) expect(JSON.parse(populated.stdout)).toEqual({ slug: valid.slug, versions: [valid] });
    else for (const text of ["2.0.0", "(current)", valid.createdAt, "aaaaaaaaaaaa"]) expect(populated.stdout).toContain(text);
    for (const response of [{ body: { versions: [] } }, { status: 404, body: { code: "SKILL_NOT_FOUND" } }]) {
      const result = await invoke(response, json); expect(result.exitCode).toBe(0);
      if (json) expect(JSON.parse(result.stdout)).toEqual({ slug: valid.slug, versions: [] });
      else expect(result.stdout).toContain("No published versions");
    }
  }
}));

test("built versions CLI refuses malformed responses before success or partial human output", async () => fixture(async invoke => {
  const canary = randomUUID(), valid = row();
  const responses: Reply[] = [
    { body: {} }, { body: { versions: null } }, { body: { versions: {} } },
    ...[{}, null, { ...valid, slug: "other" }, { ...valid, bundleByteSize: -1 },
      { ...valid, current: "yes" }, { ...valid, manifest: [] }].map(broken => ({ body: { versions: [valid, broken], error: canary } })),
    { body: `<invalid>${canary}</invalid>`, raw: true },
  ];
  for (const response of responses) for (const json of [false, true]) {
    const result = await invoke(response, json);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(canary);
    if (json) expect(JSON.parse(result.stdout)).toEqual({ error: invalidResponse });
    else { expect(result.stdout).toBe(""); expect(result.stderr.trim()).toBe(invalidResponse); }
  }
}));

test("built versions CLI keeps unsupported and denied requests nonzero without response content", async () => fixture(async invoke => {
  const canary = randomUUID();
  for (const status of [404, 405, 401, 403, 500]) for (const json of [false, true]) {
    const result = await invoke({ status, body: { code: "NOT_FOUND", error: canary } }, json);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(canary);
    expect(result.stdout + result.stderr).toContain(`HTTP ${status}`);
    if (json) expect(Object.keys(JSON.parse(result.stdout))).toEqual(["error"]);
  }
}));
