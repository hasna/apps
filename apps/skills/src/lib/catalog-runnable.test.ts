import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getPackedFiles } from "./packlist.js";
import { getDataDir } from "./config.js";
import { writeOwnedFixture } from "./private-corpus-test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

const packageRoot = resolve(import.meta.dir, "../..");

test("the actual npm packlist includes the software surfaces and no skill payload files", () => {
  const packed = getPackedFiles(packageRoot);
  for (const path of ["package.json", "bin/index.js", "bin/server.js", "bin/mcp.js", "dist/sdk/index.js"]) expect(packed).toContain(path);
  expect(packed.filter(path => /(^|\/)(?:agent-skills|skills)\//.test(path) || /(^|\/)SKILL\.md$/i.test(path))).toEqual([]);
});

test("bundle building requires an explicit private source without using the software checkout", () => {
  const out = join(getDataDir(), "bundles");
  const env = { ...process.env }; delete env.SKILLS_SOURCE;
  const result = Bun.spawnSync([process.execPath, "scripts/bundle-skills.ts", "--out", out], { cwd: packageRoot, env });
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("An explicit private skill source is required");
  expect(existsSync(out)).toBe(false);
});

test("the bundle builder accepts an owner's source and creates a versioned artifact", () => {
  const source = join(getDataDir(), "source"), out = join(getDataDir(), "bundles");
  writeOwnedFixture("owner-bundle-fixture", { root: source });
  const result = Bun.spawnSync([process.execPath, "scripts/bundle-skills.ts", "--source", source, "--out", out, "--commit", "fixture-source"], { cwd: packageRoot });
  expect(result.exitCode).toBe(0);
  expect(existsSync(join(out, "owner-bundle-fixture-1.0.0.tar.gz"))).toBe(true);
  const publish = JSON.parse(readFileSync(join(out, "owner-bundle-fixture-1.0.0.server.json"), "utf8"));
  expect(publish).toMatchObject({ slug: "owner-bundle-fixture", version: "1.0.0", kind: "instruction" });
  expect(existsSync(join(packageRoot, "skills"))).toBe(false);
});
