import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

const scratch = mkdtempSync(join(tmpdir(), "skills-search-pin-"));
const binary = join(scratch, "skills.js"), guard = join(scratch, "guard.js");
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  writeFileSync(guard, `import cp from 'node:child_process';import{syncBuiltinESMExports}from'node:module';const deny=()=>{throw Error('OWNED_INTERACTIVE_REFUSAL')};Bun.spawn=deny;Bun.spawnSync=deny;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;syncBuiltinESMExports();globalThis.fetch=async()=>deny();`);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function journey(cancel: boolean) {
  const root = mkdtempSync(join(scratch, "owned-"));
  const home = join(root, "home"), project = join(root, "project"), data = join(root, "data");
  for (const path of [home, project, data, join(project, ".skills")]) mkdirSync(path);
  const config = join(project, ".skills/project.json");
  const original = { pinnedSkills: ["owned-existing"], pins: {}, defaultExportDir: "owned-export", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  writeFileSync(config, JSON.stringify(original));
  const env = { HOME: home, USERPROFILE: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TERM: "xterm-256color", LANG: "C.UTF-8", NO_COLOR: "1", HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"), HASNA_SKILLS_DIR: data, HASNA_SKILLS_LOCAL: "1", TMPDIR: root, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  for (const name of ["qz-owned-match", "owned-decoy"]) {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, "new", name, "--kind", "instruction", "--json"], { cwd: project, env, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      expect(JSON.parse(stdout).name).toBe(name);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
    }
  }
  const steps = [
    { waitFor: "What would you like to do?", send: "\u001b[B" },
    { waitFor: "❯ Search skills", send: "\r" },
    { waitFor: "Type at least 2 characters to search", send: "q" },
    { waitFor: "Search: q", send: "z" },
    { waitFor: "Found 1 skill(s)", send: "\u001b[B" },
    { waitFor: "❯ [ ] Qz Owned Match", send: "\r" },
    { waitFor: "Selected: qz-owned-match", send: cancel ? "\u001b" : "\u001b[B" },
    ...(cancel ? [
      { waitFor: "", send: "\u001b" },
      { waitFor: "What would you like to do?", send: "q" },
    ] : [
      { waitFor: "❯ [x] Qz Owned Match", send: "\u001b[B" },
      { waitFor: "❯\r\n", send: "\u001b[B" },
      { waitFor: "❯ ✓ Pin selected (1)", send: "\r" },
      { waitFor: "Pinning complete!", send: "q" },
    ]),
  ];
  const child = Bun.spawn(["python3", resolve(import.meta.dir, "cli.interactive-pty.fixture.py"), process.execPath, "--no-env-file", "--preload", guard, binary, "interactive"], { cwd: project, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(JSON.stringify({ steps })); await child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ code, stderr, report: JSON.parse(stdout) }).toMatchObject({ code: 0, stderr: "", report: { passed: true, steps: steps.length, rawInputObserved: true } });
  const persisted = JSON.parse(readFileSync(config, "utf8"));
  if (cancel) expect(persisted).toEqual(original);
  else {
    expect(persisted.pinnedSkills).toEqual(["owned-existing", "qz-owned-match"]);
    expect(persisted.pins["qz-owned-match"]).toMatchObject({ source: "custom" });
    expect(persisted.defaultExportDir).toBe(original.defaultExportDir);
    expect(persisted.createdAt).toBe(original.createdAt);
  }
}
test("real interactive search accepts q, selects and persists only the confirmed skill", () => journey(false));
test("Escape cancels a selected search result without changing project pins", () => journey(true));
