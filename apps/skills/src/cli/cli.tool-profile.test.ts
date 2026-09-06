import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-tool-profile-"));
const binary = join(scratch, "skills.js");
const guard = join(scratch, "guard.js");
beforeAll(async () => {
  const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "index.tsx")], outdir: scratch, naming: "skills.js", target: "bun" });
  expect(build.success).toBe(true);
  writeFileSync(guard, `const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.protocol!=='data:') throw Error('fixture: network denied');
 return originalFetch(input,init);
};`);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function builtCli(args: string[], poisonConfig = false) {
  const cwd = mkdtempSync(join(scratch, "consumer-"));
  const data = join(cwd, "data"), config = join(cwd, "skills.config.json");
  mkdirSync(data);
  const sentinel = join(data, "sentinel.json");
  writeFileSync(sentinel, '{"owned":"unchanged"}\n');
  // Catalog loading rejects this retired setting. Invalid command-line input
  // must fail first, without reaching that filesystem configuration check.
  const configBytes = '{"apiUrl":"https://profile-canary.invalid"}\n';
  if (poisonConfig) writeFileSync(config, configBytes);
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: scratch, NO_COLOR: "1", TERM: "dumb",
    HASNA_HOME: join(cwd, "hasna"), HASNA_CONFIG_HOME: join(cwd, "config"), HASNA_SKILLS_DIR: data,
    HASNA_STATION: "skills-tool-profile-no-keychain-entry", SKILLS_TEST_MODE: "1" };
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, ...args],
    { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stdout.length + stderr.length).toBeLessThan(32_000);
    expect(readFileSync(sentinel, "utf8")).toBe('{"owned":"unchanged"}\n');
    if (poisonConfig) expect(readFileSync(config, "utf8")).toBe(configBytes);
    return { stdout, stderr, exitCode };
  } finally { clearTimeout(timer); }
}

describe("built CLI tool profile validation", () => {
  test("rejects invalid profiles in human and JSON invocations before loading catalog configuration", async () => {
    for (const json of [false, true]) {
      for (const profile of ["invalid-profile", "", "BASIC", " all "]) {
        const result = await builtCli(["tools", "validate", "--profile", profile, ...(json ? ["--json"] : [])], true);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("--profile");
        expect(result.stderr).toContain("Allowed choices are basic, all");
        expect(result.stderr).not.toContain("apiUrl");
      }
    }
  });

  test("the filesystem configuration canary detects valid-profile catalog loading", async () => {
    const result = await builtCli(["tools", "validate", "--profile", "basic", "--json"], true);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("apiUrl");
    expect(result.stderr).not.toContain("Allowed choices");
  });

  test("preserves basic, all and the default all profile in actual CLI output", async () => {
    const results = [];
    for (const profile of [undefined, "basic", "all"]) {
      const result = await builtCli(["tools", "validate", ...(profile ? ["--profile", profile] : []), "--json"]);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toMatchObject({ schemaVersion: 1, valid: true, profile: profile ?? "all", issues: [] });
      expect(data.mappedSkillCount).toBe(data.skillCount);
      expect(data.skillCount).toBeGreaterThan(0);
      results.push(data);
    }
    expect(results[0]).toEqual(results[2]);
    expect(results[1].skillCount).toBeLessThanOrEqual(results[2].skillCount);
    const human = await builtCli(["tools", "validate", "--profile", "basic"]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain(`Primitive coverage ok: ${results[1].skillCount}/${results[1].skillCount}`);
    const instanceProfile = await builtCli(["--profile", "customer-fixture", "tools", "validate", "--json"]);
    expect(instanceProfile.exitCode).toBe(0);
    expect(JSON.parse(instanceProfile.stdout)).toEqual(results[2]);
  });
});
