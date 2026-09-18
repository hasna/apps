import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliInCwd } from "./cli.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-hook-bindings-")); homes.push(home);
  return {
    policy: () => JSON.parse(readFileSync(join(home, ".hasna", "skills", "agent-policy.json"), "utf8")),
    async install(args: string[]) {
      const result = await runCliInCwd(["hook", "install", "--agent", "claude", "--json", ...args], home, { HOME: home, HASNA_HOME: join(home, ".hasna") });
      expect(result.exitCode).toBe(0);
      return JSON.parse(result.stdout);
    },
  };
}

test("CLI omitted flags preserve a fleet reinstall while explicit default values override it", async () => {
  const f = fixture();
  await f.install(["--command", "/opt/bin/skills", "--selection-profile", "fleet", "--apply"]);
  expect((await f.install([])).planned).toEqual([]);
  expect((await f.install(["--apply"])).changed).toEqual([]);
  expect(f.policy().bridge.commands.claude).toBe("/opt/bin/skills");
  expect(f.policy().bridge.profiles.claude).toBe("fleet");
  await f.install(["--selection-profile", "default", "--apply"]);
  expect(f.policy().bridge.commands.claude).toBe("/opt/bin/skills");
  expect(f.policy().bridge.profiles.claude).toBe("default");
  await f.install(["--command", "skills", "--apply"]);
  expect(f.policy().bridge.commands.claude).toBe("skills");
});

test("CLI new installation retains the normal command and profile defaults", async () => {
  const f = fixture();
  await f.install(["--apply"]);
  expect(f.policy().bridge.commands.claude).toBe("skills");
  expect(f.policy().bridge.profiles.claude).toBe("default");
  expect(f.policy().profileId).toBe("default");
});
