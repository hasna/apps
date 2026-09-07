import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

async function fixture(action: (run: (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>, file: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skills-cli-schedule-errors-"));
  const guard = join(root, "network-guard.ts");
  await writeFile(guard, `const request=globalThis.fetch; globalThis.fetch=((input,init)=>{
    if(new URL(input instanceof Request?input.url:String(input)).protocol!=="data:") throw new Error("Schedule fixture forbids HTTP");
    return request(input,init);
  });`);
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, join(import.meta.dir, "index.tsx"), ...args], {
      cwd: root, stdout: "pipe", stderr: "pipe", stdin: "ignore",
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HASNA_HOME: join(root, "home"),
        HASNA_SKILLS_DIR: join(root, "data"), HASNA_PROFILE: "schedule-errors", HASNA_STATION: "schedule-errors-no-keychain",
        SKILLS_TEST_MODE: "1", NO_COLOR: "1", TZ: "UTC" },
    });
    const timer = setTimeout(() => child.kill(), 15_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(timer); }
  };
  try { await action(run, join(root, ".skills/schedules.json")); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("invalid schedule admission exits nonzero in human and JSON modes without creating scheduler state", async () => {
  await fixture(async (run, file) => {
    for (const json of [false, true]) for (const cron of ["61 * * * *", "not-a-cron"]) {
      const result = await run(["schedule", "add", "local-fixture", cron, ...(json ? ["--json"] : [])]);
      expect(result.exitCode).toBe(1);
      const error = json ? JSON.parse(result.stdout).error : result.stderr;
      expect(typeof error).toBe("string");
      expect(error.length).toBeGreaterThan(0);
      expect(result.stdout).not.toContain("\u001b[");
      if (json) expect(JSON.parse(result.stdout).schedule).toBeUndefined();
      else expect(result.stdout).toBe("");
      expect(await Bun.file(file).exists()).toBe(false);
    }
  });
});

test("successful human and JSON schedule admission persists records while rejected additions preserve their exact bytes", async () => {
  await fixture(async (run, file) => {
    for (const json of [false, true]) {
      const name = json ? "json-fixture" : "human-fixture";
      const added = await run(["schedule", "add", "local-fixture", "*/15 * * * *", "--name", name, "--args", "--topic fixture", ...(json ? ["--json"] : [])]);
      expect(added.exitCode).toBe(0);
      const before = await readFile(file, "utf8");
      const disk = JSON.parse(before);
      expect(disk.version).toBe(1);
      expect(disk.schedules).toHaveLength(json ? 2 : 1);
      const schedule = disk.schedules.find((row: { name: string }) => row.name === name);
      expect(schedule).toMatchObject({ name, skill: "local-fixture", cron: "*/15 * * * *", args: ["--topic", "fixture"], enabled: true });
      expect(typeof schedule.id).toBe("string");
      expect(Date.parse(schedule.nextRun)).toBeGreaterThan(Date.parse(schedule.createdAt));
      if (json) expect(JSON.parse(added.stdout).schedule).toEqual(schedule);
      else expect(added.stdout).toContain(name);

      const rejected = await run(["schedule", "add", "local-fixture", "61 * * * *", "--name", "must-not-exist", ...(json ? ["--json"] : [])]);
      expect(rejected.exitCode).toBe(1);
      expect(json ? JSON.parse(rejected.stdout).error : rejected.stderr).toContain("minute");
      expect(await readFile(file, "utf8")).toBe(before);
    }
  });
});
