import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { buildCliFixture } from "./cli-build.fixture.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-storage-arguments-"));
const binary = join(scratch, "skills.js");
const guard = join(scratch, "guard.js");
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  writeFileSync(guard, `const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol !== "data:") throw Error("fixture: network denied");
  return originalFetch(input, init);
};\n`);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function consumer(options: { migration?: boolean; poisonedSnapshot?: boolean } = {}) {
  const cwd = realpathSync(mkdtempSync(join(scratch, "consumer-")));
  const data = join(cwd, "data");
  mkdirSync(join(cwd, ".skills"));
  writeFileSync(join(cwd, ".skills", "sentinel.json"), '{"owned":"unchanged"}\n');
  if (options.poisonedSnapshot) {
    // A valid sync-plan must encounter this owned dangling entry. A parser
    // error must happen first, without traversing the snapshot at all.
    symlinkSync(join(cwd, "missing-owned-target"), join(cwd, ".skills", "broken-entry"));
  }
  if (options.migration) {
    for (const [path, bytes] of [
      ["installed/example-skill/SKILL.md", "# Installed skill\n"],
      ["legacy-skill/SKILL.md", "# Legacy skill\n"],
      ["custom/keep.txt", "Keep this custom file.\n"],
    ] as const) {
      mkdirSync(dirname(join(data, path)), { recursive: true });
      writeFileSync(join(data, path), bytes);
    }
  }
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: scratch,
    HOME: cwd, HASNA_HOME: join(cwd, "hasna"), HASNA_CONFIG_HOME: join(cwd, "config"),
    HASNA_SKILLS_DIR: data, HASNA_STATION: "skills-storage-no-keychain-entry",
    NO_COLOR: "1", TERM: "dumb", SKILLS_TEST_MODE: "1",
  };
  return { cwd, data, env };
}

/** Capture names, types, bytes and write metadata without following the poison symlink. */
function tree(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  function visit(path: string, relative: string) {
    const stat = lstatSync(path);
    const identity = `${stat.ino}:${stat.mode}:${stat.mtimeMs}`;
    if (stat.isSymbolicLink()) entries[relative] = `link:${readlinkSync(path)}`;
    else if (stat.isDirectory()) {
      entries[relative] = "directory";
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${relative}/${name}`);
    } else entries[relative] = `file:${readFileSync(path).toString("base64")}`;
    entries[relative] += `:${identity}`;
  }
  visit(root, ".");
  return entries;
}

async function builtCli(fixture: ReturnType<typeof consumer>, args: string[]) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, "storage", ...args], {
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

describe("built CLI storage argument validation", () => {
  for (const command of ["status", "sync-plan", "migrate"]) {
    for (const json of [false, true]) {
      test(`${command} rejects excess arguments before filesystem work (${json ? "JSON" : "human"})`, async () => {
        const fixture = consumer({ migration: command === "migrate", poisonedSnapshot: command === "sync-plan" });
        const before = tree(fixture.cwd);
        for (const extra of [["unexpected"], ["--", "unexpected", "another"]]) {
          const result = await builtCli(fixture, [command, ...(json ? ["--json"] : []), ...extra]);
          expect(tree(fixture.cwd)).toEqual(before);
          expect(result.exitCode).toBe(1);
          expect(result.stdout).toBe("");
          expect(result.stderr).toContain(`too many arguments for '${command}'`);
          expect(result.stderr).toContain("Expected 0 arguments");
          expect(result.stderr).not.toContain("ENOENT");
          expect(result.stderr).not.toContain("Migrated");
        }
      });
    }
  }

  test("status still reports the selected local paths in JSON and human output", async () => {
    const fixture = consumer();
    expect(existsSync(fixture.data)).toBe(false);
    const result = await builtCli(fixture, ["status", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ package: "skills", local: { dataDir: fixture.data, projectStateDir: join(fixture.cwd, ".skills") }, remote: { databaseConfigured: false, s3Configured: false } });
    expect(existsSync(fixture.data)).toBe(true);
    const human = await builtCli(fixture, ["status"]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("Hasna Skills storage");
    expect(human.stdout).toContain(join(fixture.cwd, ".skills"));
  });

  test("sync-plan preserves schema and snapshot semantics without network or writes", async () => {
    const fixture = consumer();
    const before = tree(fixture.cwd);
    const result = await builtCli(fixture, ["sync-plan", "--json", "--schema-sql"]);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data).toMatchObject({ package: "skills", noNetwork: true, snapshotFileCount: 1, s3ObjectCount: 0, databaseConfigured: false, s3Configured: false });
    expect(data.schemaSql).toContain("CREATE TABLE IF NOT EXISTS skills_sync_records");
    const human = await builtCli(fixture, ["sync-plan", "--schema-sql"]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("Snapshot files: 1");
    expect(human.stdout).toContain(data.schemaSql);
    expect(tree(fixture.cwd)).toEqual(before);
  });

  test("the poisoned snapshot canary detects a valid handler invocation", async () => {
    const fixture = consumer({ poisonedSnapshot: true });
    const before = tree(fixture.cwd);
    const result = await builtCli(fixture, ["sync-plan", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ENOENT");
    expect(result.stderr).not.toContain("too many arguments");
    expect(tree(fixture.cwd)).toEqual(before);
  });

  for (const json of [false, true]) {
    test(`migrate preserves dry-run, actual moves and idempotence (${json ? "JSON" : "human"})`, async () => {
      const fixture = consumer({ migration: true });
      const before = tree(fixture.cwd);
      const format = json ? ["--json"] : [];
      const dry = await builtCli(fixture, ["migrate", "--dry-run", ...format]);
      expect(dry.exitCode).toBe(0);
      if (json) expect(JSON.parse(dry.stdout)).toMatchObject({ status: "migrated", moved: ["installed", "legacy-skill"], created: [] });
      else expect(dry.stdout).toContain("Dry-run; nothing was moved.");
      expect(tree(fixture.cwd)).toEqual(before);
      const migrated = await builtCli(fixture, ["migrate", ...format]);
      expect(migrated.exitCode).toBe(0);
      if (json) expect(JSON.parse(migrated.stdout)).toMatchObject({ status: "migrated", moved: ["installed", "legacy-skill"] });
      else expect(migrated.stdout).toContain("Migrated 2 entries into skills/");
      expect(existsSync(join(fixture.data, "installed"))).toBe(false);
      expect(existsSync(join(fixture.data, "legacy-skill"))).toBe(false);
      expect(readFileSync(join(fixture.data, "skills", "example-skill", "SKILL.md"), "utf8")).toBe("# Installed skill\n");
      expect(readFileSync(join(fixture.data, "skills", "legacy-skill", "SKILL.md"), "utf8")).toBe("# Legacy skill\n");
      expect(readFileSync(join(fixture.data, "custom", "keep.txt"), "utf8")).toBe("Keep this custom file.\n");
      expect(JSON.parse(readFileSync(join(fixture.data, "skills", ".layout-migration.json"), "utf8"))).toMatchObject({ version: 1, moved: ["installed", "legacy-skill"] });
      expect(existsSync(join(fixture.data, "logs"))).toBe(true);
      expect(existsSync(join(fixture.data, "outputs"))).toBe(true);
      const after = tree(fixture.cwd);
      const again = await builtCli(fixture, ["migrate", ...format]);
      expect(again.exitCode).toBe(0);
      if (json) expect(JSON.parse(again.stdout)).toMatchObject({ status: "already-migrated", moved: [], created: [] });
      else expect(again.stdout).toContain("Layout already migrated; nothing to do.");
      expect(tree(fixture.cwd)).toEqual(after);
    });
  }
});
