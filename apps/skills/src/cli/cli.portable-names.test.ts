import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { buildCliFixture } from "./cli-build.fixture.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-cli-portable-names-"));
const binary = join(scratch, "skills.js"), guard = join(scratch, "guard.js");
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  // A rejected Promise preserves fetch semantics, including local WASM fallback.
  writeFileSync(guard, "globalThis.fetch = async () => { throw Error('fixture: network denied'); };\n");
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function consumer() {
  const cwd = mkdtempSync(join(scratch, "consumer-")), data = join(cwd, "data");
  return { cwd, data, root: join(data, "installed"), env: {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: scratch, HOME: cwd,
    HASNA_HOME: join(cwd, "hasna"), HASNA_CONFIG_HOME: join(cwd, "config"), HASNA_SKILLS_DIR: data,
    HASNA_STATION: "skills-portable-no-keychain-entry", NO_COLOR: "1", TERM: "dumb", SKILLS_TEST_MODE: "1",
  } };
}

async function cli(fixture: ReturnType<typeof consumer>, args: string[]) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, ...args], {
    cwd: fixture.cwd, env: fixture.env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(stdout.length + stderr.length).toBeLessThan(32_000);
    return { stdout, stderr, exitCode };
  } finally { clearTimeout(deadline); }
}

describe("built CLI portable naming and validation status", () => {
  test("new/scaffold and port/add use canonical names and refuse collisions without changing original files", async () => {
    const fixture = consumer();
    const created = await cli(fixture, ["new", "OwnedHTTPTool", "--json"]);
    expect(created.exitCode).toBe(0);
    expect(JSON.parse(created.stdout)).toMatchObject({ name: "owned-http-tool", manifest: { name: "owned-http-tool" } });
    const instruction = await cli(fixture, ["scaffold", "Owned_Under.Score", "--kind", "instruction"]);
    expect(instruction.exitCode).toBe(0);
    expect(instruction.stdout).toContain("'owned-under-score'");
    const original = readFileSync(join(fixture.root, "owned-http-tool", "skill.json"));
    const collision = await cli(fixture, ["new", "owned_http_tool", "--json"]);
    expect(collision.exitCode).toBe(1);
    expect(JSON.parse(collision.stdout).error).toContain("already exists");
    expect(readFileSync(join(fixture.root, "owned-http-tool", "skill.json"))).toEqual(original);
    const invalidName = await cli(fixture, ["scaffold", "._---", "--json"]);
    expect(invalidName.exitCode).toBe(1);
    expect(JSON.parse(invalidName.stdout).error).toContain("Invalid skill name");

    const source = join(fixture.cwd, "source");
    mkdirSync(source);
    const prose = "---\nname: SourceXMLParser\nkind: instruction\ndescription: Owned source fixture\n---\n# Preserve these bytes\n";
    writeFileSync(join(source, "SKILL.md"), prose);
    const ported = await cli(fixture, ["port", source, "--json"]);
    expect(ported.exitCode).toBe(0);
    expect(JSON.parse(ported.stdout)).toMatchObject({ name: "source-xml-parser", valid: true, issues: [] });
    const added = await cli(fixture, ["add", source, "--name", "Custom_HTTP.Reader"]);
    expect(added.exitCode).toBe(0);
    expect(added.stdout).toContain("'custom-http-reader'");
    const shadow = await cli(fixture, ["port", source, "--name", "BrandKit", "--json"]);
    expect(shadow.exitCode).toBe(1);
    expect(JSON.parse(shadow.stdout).error).toContain("shadow");
    expect(existsSync(join(fixture.root, "brand-kit"))).toBe(false);
    expect(readFileSync(join(source, "SKILL.md"), "utf8")).toBe(prose);
    expect(readdirSync(source)).toEqual(["SKILL.md"]);
  });

  test("invalid single-folder imports fail in JSON and human output and can be corrected explicitly", async () => {
    const fixture = consumer(), source = join(fixture.cwd, "invalid-source");
    mkdirSync(source);
    const manifest = { name: "OwnedInvalid", description: "Owned invalid fixture", runtime: {
      runtime: "bun", entrypoint: "src/index.ts", timeout: -1, needs_network: false,
      env: [], sandbox: "readonly-fs", system_deps: [], artifacts: [],
    } };
    const sourceBytes = JSON.stringify(manifest);
    writeFileSync(join(source, "skill.json"), sourceBytes);
    for (const command of ["port", "add"]) {
      for (const json of [true, false]) {
        const name = `invalid-${command}-${json ? "json" : "human"}`;
        const result = await cli(fixture, [command, source, "--name", name, ...(json ? ["--json"] : [])]);
        expect(result.exitCode).toBe(1);
        if (json) {
          const data = JSON.parse(result.stdout);
          expect(data).toMatchObject({ name, valid: false, path: join(fixture.root, name) });
          expect(data.issues.some((issue: { code: string }) => issue.code === "contract.timeout_invalid")).toBe(true);
        } else expect(result.stdout).toContain("Valid: no");
        // Existing behavior: files remain for correction, but do not certify validity.
        const destination = join(fixture.root, name, "skill.json");
        expect(JSON.parse(readFileSync(destination, "utf8")).runtime.timeout).toBe(-1);
        const fixed = await cli(fixture, [command, source, "--name", name, "--json"]);
        expect(fixed.exitCode).toBe(1);
        expect(JSON.parse(fixed.stdout).error).toContain("already exists");
      }
    }
    expect(readFileSync(join(source, "skill.json"), "utf8")).toBe(sourceBytes);
    manifest.runtime.timeout = 30;
    writeFileSync(join(source, "skill.json"), JSON.stringify(manifest));
    const corrected = await cli(fixture, ["port", source, "--name", "invalid-port-json", "--overwrite", "--json"]);
    expect(corrected.exitCode).toBe(0);
    expect(JSON.parse(corrected.stdout)).toMatchObject({ name: "invalid-port-json", valid: true, issues: [] });
    expect(JSON.parse(readFileSync(join(fixture.root, "invalid-port-json", "skill.json"), "utf8")).runtime.timeout).toBe(30);
  });
});
