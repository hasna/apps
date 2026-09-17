import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDataDir } from "./config.js";
import { syncSkillsToAgents } from "./agent-sync.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

test("a removed package skill cannot overwrite native content even with force", () => {
  const home = join(getDataDir(), "agent-home"), corpus = join(getDataDir(), "empty-source");
  const target = join(home, ".codewith", "skills", "retired-skill");
  mkdirSync(target, { recursive: true }); mkdirSync(corpus);
  const original = "Synthetic owner document; preserve these bytes.\n";
  writeFileSync(join(target, "SKILL.md"), original);
  expect(() => syncSkillsToAgents({ rootDir: corpus, homeDir: home, names: ["retired-skill"], agents: ["codewith"],
    sourceDir: resolve(import.meta.dir, "../.."), force: true })).toThrow("contains no skills");
  expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe(original);
});
