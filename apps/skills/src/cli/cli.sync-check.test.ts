import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { buildCliFixture } from "./cli-build.fixture.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-sync-check-cli-"));
const binary = join(scratch, "skills.js");
beforeAll(() => buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function document(name: string, body = "Owned instruction") {
  return `---\nname: ${name}\ndescription: Owned check fixture\nkind: instruction\n---\n# ${name}\n${body}\n`;
}
function put(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, { mode: 0o600 });
}
function snapshot(root: string): unknown {
  return readdirSync(root).sort().map(name => {
    const path = join(root, name), info = lstatSync(path);
    if (!info.isDirectory() && !info.isFile()) throw new Error("Unexpected fixture entry");
    return [name, info.mode, info.ino, info.mtimeMs, info.isDirectory() ? snapshot(path)
      : createHash("sha256").update(readFileSync(path)).digest("hex")];
  });
}
function fixture() {
  const root = mkdtempSync(join(scratch, "owned-"));
  const home = join(root, "home"), data = join(root, "data"), source = join(root, "package", "skills");
  const project = join(root, "project"), guard = join(root, "guard.ts");
  const env = { PATH: "/usr/bin:/bin", HOME: home, USERPROFILE: home, HASNA_HOME: join(root, "hasna"),
    HASNA_SKILLS_DIR: data, SKILLS_DATA_DIR: data, TMPDIR: join(root, "tmp"),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1", TERM: "dumb",
    HASNA_SKILLS_API_KEY_OVERRIDE: `owned-${randomUUID()}`, HASNA_SKILLS_API_URL: "http://127.0.0.1:1" };
  for (const path of [home, data, source, project, env.HASNA_HOME, env.TMPDIR]) mkdirSync(path, { recursive: true });
  put(join(project, "keep.txt"), "Caller bytes must remain unchanged.\n");
  put(join(env.HASNA_HOME, "credential-canary"), env.HASNA_SKILLS_API_KEY_OVERRIDE);
  put(guard, `import child from "node:child_process"; import { syncBuiltinESMExports } from "node:module";
const deny = () => { throw new Error("SYNC_CHECK_IO_DENIED"); };
const original = globalThis.fetch;
globalThis.fetch = ((input, options) => { const url = String(input instanceof Request ? input.url : input); if (/^https?:/.test(url)) return Promise.reject(new Error("SYNC_CHECK_IO_DENIED")); return original(input, options); });
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) child[name] = deny;
syncBuiltinESMExports(); Bun.spawn = deny; Bun.spawnSync = deny;
`);
  const corpus = (name: string, body?: string) => put(join(source, name, "SKILL.md"), document(name, body));
  const cache = (name: string, body?: string) => put(join(data, "installed", name, "SKILL.md"), document(name, body));
  const agent = (name: string, target = "codex", body?: string) => {
    put(join(home, `.${target}`, "skills", name, "SKILL.md"), document(name, body));
    put(join(home, `.${target}`, "skills", name, ".hasna-skills.json"), JSON.stringify({ managedBy: "@hasna/skills" }));
  };
  corpus("alpha"); cache("alpha"); agent("alpha");
  async function child(args: string[], extra: Record<string, string> = {}) {
    const before = snapshot(root);
    const proc = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, ...args], {
      cwd: project, env: { ...env, ...extra }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const deadline = setTimeout(() => proc.kill("SIGKILL"), 10_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(stdout.length + stderr.length).toBeLessThan(24_000);
      expect(stdout + stderr).not.toContain(env.HASNA_SKILLS_API_KEY_OVERRIDE);
      expect(snapshot(root)).toEqual(before);
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(deadline); }
  }
  return { root, home, data, source, corpus, cache, agent, child,
    cli: (args: string[], extra?: Record<string, string>) => child([binary, ...args], extra) };
}

test("sync check fixture blocks HTTP and Bun/native execution before the real CLI runs", async () => {
  const f = fixture();
  try {
    const result = await f.child(["-e", `import { execFileSync } from "node:child_process";
for (const call of [() => fetch("http://127.0.0.1:1/"), () => Bun.spawn([process.execPath, "-e", "process.exit(0)"]), () => execFileSync(process.execPath, ["-e", "process.exit(0)"])]) {
 let denied = false; try { await call(); } catch (error) { denied = error.message === "SYNC_CHECK_IO_DENIED"; }
 if (!denied) process.exit(1);
} console.log("guard-controls-passed");`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("guard-controls-passed");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

for (const json of [false, true]) {
  const flags = json ? ["--json"] : [];
  function clean(result: { exitCode: number; stdout: string }, homesChecked = 1, managed = 1) {
    expect(result.exitCode).toBe(0);
    if (json) expect(JSON.parse(result.stdout)).toEqual({ entries: [], homesChecked, managed, unmarked: 0, clean: true });
    else expect(result.stdout).toContain(`Home drift census: clean (${homesChecked} home(s) checked, ${managed} managed, 0 unmarked)`);
  }
  test(`sync check preserves an empty default cache and absent agent homes (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      rmSync(join(f.data, "installed"), { recursive: true });
      rmSync(join(f.home, ".codex", "skills", "alpha"), { recursive: true });
      clean(await f.cli(["sync", "--check", ...flags]), 1, 0);
      rmSync(join(f.home, ".codex"), { recursive: true });
      clean(await f.cli(["sync", "--check", ...flags]), 0, 0);
      clean(await f.cli(["sync", "alpha", "--check", "--for", "codex", "--source", f.source, ...flags]), 0, 0);
      const missing = await f.cli(["sync", "missing-skill", "--check", "--for", "codex", "--source", f.source, ...flags]);
      expect(missing.exitCode).toBe(1);
      if (json) expect(JSON.parse(missing.stdout).error).toContain("not found");
      else expect(missing.stderr).toContain("not found");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  test(`sync check normalizes and deduplicates multiple selected names (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      f.corpus("beta-skill"); f.agent("beta-skill");
      f.corpus("gamma"); f.agent("gamma", "codex", "Unselected drift"); f.agent("stray");
      const selection = [" ALPHA ", "Beta Skill", "beta-skill", "   "];
      clean(await f.cli(["sync", ...selection, "--check", "--for", "codex", "--source", f.source, ...flags]), 1, 2);
      f.agent("beta-skill", "codex", "Selected drift");
      const drift = await f.cli(["sync", ...selection, "--check", "--for", "codex", "--source", f.source, ...flags]);
      expect(drift.exitCode).toBe(1);
      if (json) expect(JSON.parse(drift.stdout)).toMatchObject({ clean: false, homesChecked: 1, managed: 2,
        entries: [{ agent: "codex", skill: "beta-skill", kind: "diverged" }] });
      else { expect(drift.stdout).toContain("beta-skill"); expect(drift.stdout).not.toContain("gamma"); expect(drift.stdout).not.toContain("stray"); }
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  test(`sync check honors explicit flat/package and ambient source (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      f.cache("alpha", "Cached content differs");
      const wrong = join(f.root, "wrong"); put(join(wrong, "alpha", "SKILL.md"), document("alpha", "Ambient content differs"));
      for (const source of [f.source, dirname(f.source)]) {
        clean(await f.cli(["sync", "alpha", "--check", "--for", "codex", "--source", source, ...flags], { SKILLS_SOURCE: wrong }));
      }
      clean(await f.cli(["render", "alpha", "--check", "--for", "codex", ...flags], { SKILLS_SOURCE: f.source }));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  test(`sync check limits agents and names while retaining real selected drift (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      f.corpus("beta"); f.cache("beta"); f.agent("beta", "codex", "Selected drift");
      f.agent("alpha", "claude", "Other agent drift"); f.agent("stray");
      clean(await f.cli(["sync", "alpha", "--check", "--for", "codex", "--source", f.source, ...flags]));
      for (const [name, agent] of [["beta", "codex"], ["alpha", "claude"]]) {
        const drift = await f.cli(["sync", name!, "--check", "--for", agent!, "--source", f.source, ...flags]);
        expect(drift.exitCode).toBe(1);
        if (json) expect(JSON.parse(drift.stdout)).toMatchObject({ clean: false, homesChecked: 1, managed: 1,
          entries: [{ agent, skill: name, kind: "diverged" }] });
        else { expect(drift.stdout).toContain(name!); expect(drift.stdout).toContain("diverged"); }
      }
      const all = await f.cli(["sync", "--check", ...flags]);
      expect(all.exitCode).toBe(1);
      if (json) expect(JSON.parse(all.stdout)).toMatchObject({ clean: false, homesChecked: 2, managed: 4, entries: expect.arrayContaining([
        expect.objectContaining({ agent: "codex", skill: "stray", kind: "stray-in-home" }),
        expect.objectContaining({ agent: "claude", skill: "beta", kind: "missing-from-home" }),
      ]) });
      else { expect(all.stdout).toContain("stray-in-home"); expect(all.stdout).toContain("missing-from-home"); }
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  test(`sync check rejects unknown selectors and missing source without writes (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      for (const [args, message] of [
        [["--for", "not-an-agent"], "Unknown agent"],
        [["missing-skill", "--source", f.source], "not found"],
        [["--source", join(f.root, "absent")], "contains no skills"],
      ] as const) {
        const result = await f.cli(["sync", "--check", ...args, ...flags]);
        expect(result.exitCode).toBe(1);
        if (json) expect(JSON.parse(result.stdout).error).toContain(message);
        else expect(result.stderr).toContain(message);
      }
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}
