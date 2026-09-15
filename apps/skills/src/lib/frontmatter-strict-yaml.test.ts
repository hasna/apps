import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, YAMLParseError } from "yaml";
import { scaffoldPortableSkill } from "./portable-skills.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

test("strict YAML detects an unquoted colon in a synthetic description", () => {
  expect(() => parse("name: fixture\ndescription: Synthetic contract: input and output\n")).toThrow(YAMLParseError);
});

test("owned authoring quotes descriptions for strict agent frontmatter parsers", () => {
  const description = "Synthetic contract: input and output";
  const skill = scaffoldPortableSkill("quoted-description-fixture", { kind: "instruction", description });
  const content = readFileSync(join(skill.path, "SKILL.md"), "utf8");
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  expect(block).toBeDefined();
  expect(parse(block!)).toMatchObject({ name: "quoted-description-fixture", kind: "instruction", description });
});
