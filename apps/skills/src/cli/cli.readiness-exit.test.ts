import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { buildCliFixture } from "./cli-build.fixture.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-readiness-exit-"));
const binary = join(scratch, "skills.js"), guard = join(scratch, "guard.js");
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  writeFileSync(guard, "globalThis.fetch = async () => { throw Error('fixture: network denied'); };\n");
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

for (const json of [false, true]) {
  test(`readiness exit reflects missing requirements for explicit and pinned skills (${json ? "JSON" : "human"})`, async () => {
    const cwd = mkdtempSync(join(scratch, "consumer-")), data = join(cwd, "data");
    const skill = join(data, "installed", "owned-readiness");
    mkdirSync(skill, { recursive: true });
    mkdirSync(join(cwd, ".skills"));
    const document = "---\nname: owned-readiness\ndescription: Owned readiness fixture\nkind: instruction\n---\nRequires OWNED_READINESS_TOKEN.\n";
    writeFileSync(join(skill, "SKILL.md"), document);
    const project = join(cwd, ".skills", "project.json");
    const config = JSON.stringify({ version: 1, pinnedSkills: ["owned-readiness"], pins: {} });
    writeFileSync(project, config);
    async function cli(args: string[], value = "") {
      const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, "test", ...args, ...(json ? ["--json"] : [])], {
        cwd, env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: cwd, HASNA_HOME: join(cwd, "home"),
          HASNA_SKILLS_DIR: data, HASNA_STATION: "skills-readiness-no-keychain-entry", NO_COLOR: "1", TERM: "dumb",
          SKILLS_TEST_MODE: "1", OWNED_READINESS_TOKEN: value }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try {
        const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(stdout.length + stderr.length).toBeLessThan(16_000);
        expect(stdout + stderr).not.toContain("owned-fixture-value");
        return { stdout, exitCode };
      } finally { clearTimeout(deadline); }
    }
    for (const args of [["owned-readiness"], []]) {
      for (const ready of [false, true]) {
        const result = await cli(args, ready ? "owned-fixture-value" : "");
        if (json) expect(JSON.parse(result.stdout)).toEqual([{ skill: "owned-readiness", envVars: [{ name: "OWNED_READINESS_TOKEN", set: ready }], systemDeps: [], npmDeps: [], ready }]);
        else expect(result.stdout).toContain(ready ? "All 1 skill(s) ready" : "1 skill(s) not ready");
        expect(result.exitCode).toBe(ready ? 0 : 1);
      }
    }
    expect((await cli(["owned-missing-skill"])).exitCode).toBe(1);
    expect(readFileSync(project, "utf8")).toBe(config);
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toBe(document);
    writeFileSync(project, JSON.stringify({ version: 1, pinnedSkills: [], pins: {} }));
    const empty = await cli([]);
    expect(empty.exitCode).toBe(0);
    if (json) expect(JSON.parse(empty.stdout)).toEqual([]);
    else expect(empty.stdout).toContain("No pinned skills");
  });
}
