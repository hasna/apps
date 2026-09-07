import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { buildCliFixture } from "./cli-build.fixture.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-schedule-run-"));
const binary = join(scratch, "skills.js");
beforeAll(() => buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function fixture() {
  const cwd = mkdtempSync(join(scratch, "owned-")), data = join(cwd, "data");
  const marker = join(cwd, "executions"), denied = join(cwd, "denied"), guard = join(cwd, "guard.ts");
  const sourceFiles: Array<[string, string]> = [];
  const entries: string[] = [];
  for (const [name, exitCode, hosted] of [["local-ok", 0, false], ["local-fail", 7, false], ["hosted-fixture", 0, true]] as const) {
    const dir = join(data, "installed", name), entry = join(dir, "src", "index.ts");
    mkdirSync(join(dir, "src"), { recursive: true });
    // No package installation is part of this test. The skill has no dependencies.
    mkdirSync(join(dir, "node_modules"));
    const files: Array<[string, string]> = [
      [join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", bin: { [name]: "src/index.ts" }, ...(hosted ? { skills: { runtime: "hosted" } } : {}) })],
      [join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Owned scheduled execution fixture.\n---\n# Fixture\n`],
      [entry, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(name + "\n")}); process.exitCode = ${exitCode};\n`],
    ];
    for (const [file, contents] of files) { writeFileSync(file, contents); sourceFiles.push([file, contents]); }
    if (!hosted) entries.push(entry);
  }
  writeFileSync(guard, `import { appendFileSync, realpathSync } from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const deny = (kind) => { appendFileSync(${JSON.stringify(denied)}, "denied\\n"); throw Error("owned fixture: " + kind + " denied"); };
const request = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol === "http:" || url.protocol === "https:") return deny("HTTP");
  return request(input, init);
};
const spawn = Bun.spawn.bind(Bun), allowed = ${JSON.stringify(entries)}.map(path => realpathSync(path));
Bun.spawn = (command, options) => {
  if (!Array.isArray(command) || command.length !== 3 || command[0] !== "bun" || command[1] !== "run" || !allowed.includes(realpathSync(command[2]))) return deny("unowned Bun child");
  return spawn(command, options);
};
Bun.spawnSync = () => deny("Bun sync child");
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[key] = () => deny("native child");
syncBuiltinESMExports();\n`);
  const file = join(cwd, ".skills", "schedules.json");
  mkdirSync(dirname(file));
  const writeSchedules = (skills: string[], due = true) => {
    const schedules = skills.map((skill, i) => ({ id: `owned-${i}`, name: skill, skill, cron: "* * * * *", args: [], enabled: true,
      createdAt: "2020-01-01T00:00:00.000Z", nextRun: due ? "2020-01-01T00:00:00.000Z" : "2099-01-01T00:00:00.000Z" }));
    const bytes = JSON.stringify({ version: 1, schedules }, null, 2) + "\n";
    writeFileSync(file, bytes);
    return { bytes, schedules };
  };
  // Some npm-installed Bun distributions name process.execPath bun.exe on macOS.
  // runSkill invokes `bun`, so provide that exact owned alias to this test runtime.
  const bin = join(cwd, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "bun"));
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: join(cwd, "home"), HASNA_HOME: join(cwd, "hasna-home"), HASNA_SKILLS_DIR: data,
    HASNA_SKILLS_API_URL: "http://127.0.0.1:1", HASNA_SKILLS_API_KEY_OVERRIDE: "owned-schedule-credential-canary",
    HASNA_STATION: "owned-schedule-no-keychain", NO_COLOR: "1", TERM: "dumb", TZ: "UTC", SKILLS_TEST_MODE: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  for (const directory of [env.HOME, env.HASNA_HOME]) mkdirSync(directory);
  async function childCommand(command: string[], overrides: Record<string, string> = {}) {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, ...command], {
      cwd, env: { ...env, ...overrides }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(stdout.length + stderr.length).toBeLessThan(16_000);
      expect(stdout + stderr).not.toContain(env.HASNA_SKILLS_API_KEY_OVERRIDE);
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(deadline); }
  }
  const executions = () => existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n") : [];
  const unchangedSources = () => {
    for (const [file, contents] of sourceFiles) expect(readFileSync(file, "utf8")).toBe(contents);
    expect(existsSync(denied)).toBe(false);
  };
  const cli = (args: string[], overrides: Record<string, string> = {}) => childCommand([binary, ...args], overrides);
  return { cwd, file, cli, childCommand, writeSchedules, executions, unchangedSources, denied,
    hostedEntry: join(data, "installed", "hosted-fixture", "src", "index.ts") };
}

test("owned schedule fixture actually blocks HTTP and unapproved Bun/native children", async () => {
  const f = fixture();
  try {
    for (const program of [
      'try { await fetch("http://127.0.0.1:1"); } catch { process.exitCode = 9; }',
      `try { await Bun.spawn(["bun", "run", ${JSON.stringify(f.hostedEntry)}]).exited; } catch { process.exitCode = 9; }`,
      `import { execFileSync } from "node:child_process"; try { execFileSync(process.execPath, ["run", ${JSON.stringify(f.hostedEntry)}]); } catch { process.exitCode = 9; }`,
    ]) {
      const result = await f.childCommand(["-e", program]);
      expect(result.exitCode).toBe(9);
      expect(readFileSync(f.denied, "utf8")).toBe("denied\n");
      rmSync(f.denied);
      expect(f.executions()).toEqual([]);
    }
    f.unchangedSources();
  } finally { rmSync(f.cwd, { recursive: true, force: true }); }
});

for (const json of [false, true]) {
  // Root bypasses ordinary POSIX file permissions; this case needs an actual
  // read-only owner file, rather than pretending chmod refuses root's writes.
  test.skipIf(process.getuid?.() === 0)(`history-write failure reports attempted work and continues the batch (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      const before = f.writeSchedules(["local-ok", "local-fail"]);
      chmodSync(f.file, 0o400);
      expect(() => writeFileSync(f.file, before.bytes)).toThrow();
      const result = await f.cli(["schedule", "run", ...(json ? ["--json"] : [])]);
      expect(result.exitCode).toBe(1);
      if (json) {
        const output = JSON.parse(result.stdout);
        expect(output.ran).toBe(2);
        expect(output.results).toMatchObject([
          { name: "local-ok", status: "error", attempted: true, executionStatus: "success" },
          { name: "local-fail", status: "error", attempted: true, executionStatus: "error", error: "Skill 'local-fail' exited with 7" },
        ]);
        for (const item of output.results) expect(item.historyError).toContain("Inspect the skill's effects before retrying");
      } else {
        expect(result.stdout).toContain("local-ok");
        expect(result.stdout).toContain("local-fail");
        expect(result.stdout).toContain("Inspect the skill's effects before retrying");
      }
      expect(readFileSync(f.file, "utf8")).toBe(before.bytes);
      expect(f.executions()).toEqual(["local-ok", "local-fail"]);
      f.unchangedSources();
    } finally { chmodSync(f.file, 0o600); rmSync(f.cwd, { recursive: true, force: true }); }
  });

  test(`preflight schedule refusals stay due and exit nonzero (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      for (const mode of ["hosted", "paid-flags", "missing-credential", "invalid-origin", "missing-skill"]) {
        const before = f.writeSchedules([mode === "missing-skill" ? "owned-missing-skill" : "hosted-fixture"]);
        const overrides: Record<string, string> = mode === "missing-credential" ? { HASNA_SKILLS_API_KEY_OVERRIDE: "" }
          : mode === "invalid-origin" ? { HASNA_SKILLS_API_URL: "not-a-url" } : {};
        const result = await f.cli(["schedule", "run", ...(mode === "paid-flags" ? ["--allow-paid", "--max-paid-cents", "25"] : []), ...(json ? ["--json"] : [])], overrides);
        expect(result.exitCode).toBe(1);
        if (json) {
          const output = JSON.parse(result.stdout);
          expect(output.ran).toBe(0);
          expect(output.results).toHaveLength(1);
          expect(output.results[0]).toMatchObject({ status: "error", attempted: false });
        } else expect(result.stdout).toContain("schedule remains due");
        if (mode === "hosted" || mode === "paid-flags") expect(result.stdout).toContain("Scheduled hosted runs are not supported yet");
        if (mode === "missing-credential") expect(result.stdout).toContain("REMOTE_REQUIRES_CREDENTIAL");
        if (mode === "missing-skill") expect(result.stdout).toContain("not found");
        expect(readFileSync(f.file, "utf8")).toBe(before.bytes);
        expect(f.executions()).toEqual([]);
        f.unchangedSources();
      }
    } finally { rmSync(f.cwd, { recursive: true, force: true }); }
  });

  test(`mixed schedule batch preserves per-item results and actual attempt bookkeeping (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      const before = f.writeSchedules(["local-fail", "hosted-fixture", "local-ok"]);
      const result = await f.cli(["schedule", "run", ...(json ? ["--json"] : [])]);
      expect(result.exitCode).toBe(1);
      if (json) {
        const output = JSON.parse(result.stdout);
        expect(output.ran).toBe(2);
        expect(output.results).toMatchObject([
          { name: "local-fail", status: "error", attempted: true, error: "Skill 'local-fail' exited with 7" },
          { name: "hosted-fixture", status: "error", attempted: false },
          { name: "local-ok", status: "success", attempted: true, paid: false },
        ]);
      } else for (const name of ["local-fail", "hosted-fixture", "local-ok"]) expect(result.stdout).toContain(name);
      const after = JSON.parse(readFileSync(f.file, "utf8")).schedules;
      expect(after[1]).toEqual(before.schedules[1]);
      for (const [i, status] of [[0, "error"], [2, "success"]] as const) {
        expect(after[i].lastRunStatus).toBe(status);
        expect(Date.parse(after[i].lastRun)).toBeGreaterThan(Date.parse(before.schedules[i]!.nextRun));
        expect(Date.parse(after[i].nextRun)).toBeGreaterThan(Date.parse(after[i].lastRun));
      }
      expect(f.executions()).toEqual(["local-fail", "local-ok"]);
      f.unchangedSources();
    } finally { rmSync(f.cwd, { recursive: true, force: true }); }
  });

  test(`successful local schedule, dry-run and no-due remain successful (${json ? "JSON" : "human"})`, async () => {
    const f = fixture();
    try {
      const dry = f.writeSchedules(["hosted-fixture", "local-fail"]);
      expect((await f.cli(["schedule", "run", "--dry-run", ...(json ? ["--json"] : [])])).exitCode).toBe(0);
      expect(readFileSync(f.file, "utf8")).toBe(dry.bytes);
      expect(f.executions()).toEqual([]);
      const future = f.writeSchedules(["hosted-fixture"], false);
      const none = await f.cli(["schedule", "run", ...(json ? ["--json"] : [])]);
      expect(none.exitCode).toBe(0);
      if (json) expect(JSON.parse(none.stdout)).toEqual({ ran: 0, schedules: [] });
      expect(readFileSync(f.file, "utf8")).toBe(future.bytes);
      f.writeSchedules(["local-ok"]);
      const ok = await f.cli(["schedule", "run", ...(json ? ["--json"] : [])]);
      expect(ok.exitCode).toBe(0);
      if (json) expect(JSON.parse(ok.stdout)).toMatchObject({ ran: 1, results: [{ status: "success", attempted: true, paid: false }] });
      expect(f.executions()).toEqual(["local-ok"]);
      expect(JSON.parse(readFileSync(f.file, "utf8")).schedules[0].lastRunStatus).toBe("success");
      f.unchangedSources();
    } finally { rmSync(f.cwd, { recursive: true, force: true }); }
  });
}
