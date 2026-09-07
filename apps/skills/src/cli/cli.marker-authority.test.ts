import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { useDefaultTestTimeout } from "../test-preload.js";
import { buildCliFixture } from "./cli-build.fixture.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-marker-authority-"));
const installed = process.env.SKILLS_SYNC_OWNERSHIP_TEST_PACKAGE;
const binary = installed ? join(installed, "bin/index.js") : join(scratch, "skills.js");
const apiEntry = pathToFileURL(installed ? join(installed, "dist/index.js") : resolve(import.meta.dir, "../index.ts")).href;
beforeAll(async () => { if (!installed) await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const document = (name: string, body: string) => `---\nname: ${name}\ndescription: Owned marker fixture\n---\n\n${body}\n`;
function snapshot(path: string): unknown {
  const stat = lstatSync(path);
  if (stat.isDirectory()) return [stat.mode, stat.ino, stat.mtimeMs, readdirSync(path).sort().map(name => [name, snapshot(join(path, name))])];
  if (!stat.isFile()) throw Error("Unexpected fixture file");
  return [stat.mode, stat.ino, stat.mtimeMs, sha(readFileSync(path))];
}

// Independent single-file POSIX ustar fixture, not the producer's packer.
function bundle(text: string): Buffer {
  const body = Buffer.from(text), header = Buffer.alloc(512);
  header.write("SKILL.md", 0); header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124); header.write("00000000000\0", 136);
  header.fill(32, 148, 156); header.write("0", 156); header.write("ustar\0", 257); header.write("00", 263);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148);
  return gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512 + 1024)]));
}

function fixture() {
  const root = mkdtempSync(join(scratch, "owned-")), home = join(root, "home"), project = join(root, "project"), data = join(root, "data"), corpus = join(data, "skills");
  for (const path of [home, project, corpus, join(root, "tmp")]) mkdirSync(path, { recursive: true });
  writeFileSync(join(corpus, ".layout-migration.json"), "{}\n");
  for (const path of [join(home, "keep.txt"), join(project, "keep.txt"), join(data, "keep.txt")]) writeFileSync(path, "Owned unrelated bytes\n", { mode: 0o640 });
  const token = randomUUID(), guard = join(root, "guard.js"), denied = join(root, "denied.log"), calls: Array<{ method: string; path: string }> = [];
  let row: Record<string, unknown> | undefined, bytes: Buffer = Buffer.alloc(0);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname; calls.push({ method: request.method, path });
    if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response(null, { status: 401 });
    if (request.method !== "GET") return new Response(null, { status: 405 });
    if (path.startsWith("/tombstone/")) return new Response(null, { status: path.endsWith("/bundle") ? 410 : 404 });
    if (path === "/registry/api/v1/skills") return Response.json(row ? [row] : []);
    if (row && path === `/registry/api/v1/skills/${row.slug}`) return Response.json(row);
    if (row && path === `/registry/api/v1/skills/${row.slug}/bundle`) return new Response(Uint8Array.from(bytes), { headers: { "Content-Type": "application/gzip", "X-Skill-Bundle-Sha256": sha(bytes), "X-Skill-Version": "1.0.0" } });
    return new Response(null, { status: 404 });
  } });
  const origin = server.url.origin;
  writeFileSync(guard, `import {appendFileSync} from "node:fs";import child from "node:child_process";import {syncBuiltinESMExports} from "node:module";
const deny=()=>{appendFileSync(process.env.QA_DENIED,"blocked\\n");throw Error("MARKER_AUTHORITY_IO_REFUSED")};const original=globalThis.fetch;
globalThis.fetch=(input,options)=>{const url=String(input instanceof Request?input.url:input);if(/^https?:/.test(url)&&new URL(url).origin!==process.env.QA_ORIGIN)return Promise.reject(deny());return original(input,options)};
for(const name of["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"])child[name]=deny;syncBuiltinESMExports();Bun.spawn=deny;Bun.spawnSync=deny;`);
  const env = { HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, SKILLS_DATA_DIR: data,
    PATH: "", TMPDIR: join(root, "tmp"), NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", QA_ORIGIN: origin, QA_DENIED: denied,
    HASNA_SKILLS_API_KEY_OVERRIDE: token, HASNA_SKILLS_API_URL: origin + "/registry" };
  async function invoke(args: string[], readOnly = false, control = false) {
    const before = readOnly ? snapshot(root) : undefined, homeBefore = snapshot(home), projectBefore = snapshot(project), keptBefore = snapshot(join(data, "keep.txt"));
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, ...args], { cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    let timedOut = false; const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 10_000);
    try {
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(timedOut).toBe(false); expect(stdout.length + stderr.length).toBeLessThan(30_000); expect(stdout + stderr).not.toContain(token);
      expect(snapshot(home)).toEqual(homeBefore); expect(snapshot(project)).toEqual(projectBefore); expect(snapshot(join(data, "keep.txt"))).toEqual(keptBefore);
      if (!control) expect(existsSync(denied)).toBe(false);
      if (readOnly) expect(snapshot(root)).toEqual(before);
      return { stdout, stderr, exit };
    } finally { clearTimeout(timer); }
  }
  return { root, home, project, corpus, denied, calls, invoke,
    target(name: string) { const target = join(corpus, name); mkdirSync(target); writeFileSync(join(target, "SKILL.md"), document(name, "Owned local content")); writeFileSync(join(target, "keep.txt"), "Owned local resource\n", { mode: 0o640 }); return target; },
    remote(name: string) { const text = document(name, "Owned remote replacement"); bytes = bundle(text); row = { slug: name, name, description: "Owned marker fixture", version: "1.0.0", kind: "instruction", bundleSha256: sha(bytes) }; return { text, sha256: sha(bytes) }; },
    pull(name: string) { return invoke(["-e", `const api=await import(${JSON.stringify(apiEntry)});const client=new api.RemoteSkillsClient(process.env.HASNA_SKILLS_API_KEY_OVERRIDE,process.env.QA_ORIGIN+"/tombstone");console.log(JSON.stringify(await api.pullSkills({rootDir:${JSON.stringify(corpus)},names:[${JSON.stringify(name)}],client,signingKey:""})));`]); },
    close() { server.stop(true); rmSync(root, { recursive: true, force: true }); },
  };
}

test("marker fixture blocks unowned HTTP and native processes", async () => {
  const f = fixture();
  try {
    const script = `import {execFileSync} from "node:child_process";for(const call of[()=>fetch("http://127.0.0.1:1"),()=>Bun.spawn(["/usr/bin/true"]),()=>execFileSync("/usr/bin/true")]){let refused=false;try{await call()}catch(e){refused=e.message==="MARKER_AUTHORITY_IO_REFUSED"}if(!refused)process.exit(1)}console.log("guard-controls-passed");`;
    const result = await f.invoke(["-e", script], false, true);
    expect(result.exit).toBe(0); expect(result.stdout.trim()).toBe("guard-controls-passed"); expect(result.stderr).toBe("");
    expect(readFileSync(f.denied, "utf8")).toBe("blocked\nblocked\nblocked\n"); expect(f.calls).toEqual([]);
  } finally { f.close(); }
});

for (const owner of ["unmarked", "foreign", "malformed", "skills"] as const) {
  test(`actual pull tombstones require Skills ownership: ${owner}`, async () => {
    const f = fixture(), name = "marker-tombstone-" + owner;
    try {
      const target = f.target(name), other = f.target("unrelated");
      if (owner !== "unmarked") writeFileSync(join(target, ".hasna-skills.json"), owner === "malformed" ? "{ invalid\n" : JSON.stringify({ managedBy: owner === "skills" ? "@hasna/skills" : "another-tool" }));
      const before = snapshot(f.root), otherBefore = snapshot(other), result = await f.pull(name);
      expect(result.exit).toBe(0); expect(result.stderr).toBe("");
      const value = JSON.parse(result.stdout).results[0];
      expect(value).toMatchObject({ name, success: true, tombstoned: true, removed: owner === "skills" });
      expect(existsSync(target)).toBe(owner !== "skills"); expect(snapshot(other)).toEqual(otherBefore);
      expect(f.calls).toEqual([{ method: "GET", path: `/tombstone/api/v1/skills/${name}` }, { method: "GET", path: `/tombstone/api/v1/skills/${name}/bundle` }]);
      if (owner !== "skills") { expect(value.leftInPlace).toBe(true); expect(snapshot(f.root)).toEqual(before); }
      else { const repeated = await f.pull(name); expect(repeated.exit).toBe(0); expect(JSON.parse(repeated.stdout).results[0]).toMatchObject({ success: true, removed: false, leftInPlace: true }); }
    } finally { f.close(); }
  });

  test(`registry baseline authority requires Skills ownership: ${owner}`, async () => {
    const f = fixture(), name = "marker-baseline-" + owner;
    try {
      const target = f.target(name), remote = f.remote(name), args = [binary, "cloud", "sync", "--pull", "--json"];
      const initial = await f.invoke([...args, "--dry-run"], true); expect(initial.exit).toBe(0);
      const first = JSON.parse(initial.stdout).skills; expect(first).toHaveLength(1); expect(first[0]).toMatchObject({ slug: name, state: "conflict", action: "skip" });
      expect(first[0].localSha256).toMatch(/^[a-f0-9]{64}$/); expect(first[0].remoteSha256).toBe(remote.sha256);
      // Forge the actual CLI-reported local baseline, without granting it Skills ownership.
      if (owner !== "unmarked") writeFileSync(join(target, ".hasna-skills.json"), owner === "malformed" ? "{ invalid\n" : JSON.stringify({ managedBy: owner === "skills" ? "@hasna/skills" : "another-tool", contentHash: first[0].localSha256, version: "1.0.0" }));
      const before = snapshot(target), planned = await f.invoke([...args, "--dry-run"], true); expect(planned.exit).toBe(0);
      expect(JSON.parse(planned.stdout).skills[0]).toMatchObject({ slug: name, state: owner === "skills" ? "changed-remotely" : "conflict", action: owner === "skills" ? "pull" : "skip" });
      const offset = f.calls.length, applied = await f.invoke(args); expect(applied.exit).toBe(0); expect(applied.stderr).toBe("");
      expect(JSON.parse(applied.stdout).summary.pulled).toBe(owner === "skills" ? 1 : 0);
      expect(f.calls.slice(offset).every(call => call.method === "GET")).toBe(true);
      expect(f.calls.slice(offset).filter(call => call.path.endsWith("/bundle"))).toHaveLength(owner === "skills" ? 1 : 0);
      if (owner === "skills") {
        expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe(remote.text); expect(existsSync(join(target, "keep.txt"))).toBe(false);
        expect(JSON.parse(readFileSync(join(target, ".hasna-skills.json"), "utf8"))).toMatchObject({ managedBy: "@hasna/skills", version: "1.0.0", contentHash: remote.sha256 });
      } else expect(snapshot(target)).toEqual(before);
      if (owner === "foreign") {
        const local = await f.invoke([binary, "cloud", "sync", "--push", "--conflict", "local", "--dry-run", "--json"], true);
        expect(local.exit).toBe(0); expect(JSON.parse(local.stdout).skills[0]).toMatchObject({ state: "conflict", action: "push" });
        const explicit = await f.invoke([...args, "--conflict", "remote"]); expect(explicit.exit).toBe(0); expect(JSON.parse(explicit.stdout).summary.pulled).toBe(1);
        expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe(remote.text); expect(existsSync(join(target, "keep.txt"))).toBe(false);
      }
    } finally { f.close(); }
  });
}
