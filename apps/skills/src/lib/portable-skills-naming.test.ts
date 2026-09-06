import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findPortableSkill, getPortableSkillPath, listPortableSkills, normalizePortableSkillName,
  portPortableSkill, portPortableSkillDirectory, readPortableSkillManifest, scaffoldPortableSkill,
  validatePortableSkillDirectory,
} from "./portable-skills.js";

function fixture(run: (root: string, sources: string) => void) {
  const scratch = mkdtempSync(join(tmpdir(), "portable-names-"));
  const root = join(scratch, "installed"), sources = join(scratch, "sources");
  mkdirSync(sources);
  try { run(root, sources); } finally { rmSync(scratch, { recursive: true, force: true }); }
}

describe("portable skill creation names", () => {
  test("new identities retain word boundaries and use only hyphen separators", () => fixture((root) => {
    for (const [input, name] of [
      ["OwnedCamelCase", "owned-camel-case"], ["XMLHttpTool", "xml-http-tool"],
      ["  Owned__Under.Score -- v2API  ", "owned-under-score-v2-api"],
      ["already-hyphenated", "already-hyphenated"], ["joinedlowercase", "joinedlowercase"],
    ]) {
      const result = scaffoldPortableSkill(input!, { rootDir: root });
      expect(result.name).toBe(name!);
      expect(result.path).toBe(join(root, name!));
      expect(readPortableSkillManifest(result.path).name).toBe(name!);
      expect(JSON.parse(readFileSync(join(result.path, "package.json"), "utf8")).bin).toEqual({ [name!]: "src/index.ts" });
    }
  }));

  test("empty normalized names and canonical collisions refuse before overwriting files", () => fixture((root) => {
    for (const name of ["", "   ", "._---", "💫"]) {
      expect(() => scaffoldPortableSkill(name, { rootDir: root })).toThrow("Invalid skill name");
    }
    const existing = scaffoldPortableSkill("OwnReport", { rootDir: root });
    const bytes = readFileSync(join(existing.path, "skill.json"));
    expect(() => scaffoldPortableSkill("own_report", { rootDir: root })).toThrow("already exists");
    expect(readFileSync(join(existing.path, "skill.json"))).toEqual(bytes);
    expect(readdirSync(root)).toEqual(["own-report"]);
  }));

  test("existing dotted and underscored identities keep their paths and command names", () => fixture((root) => {
    const name = "legacy_tool.v2", path = join(root, name);
    mkdirSync(path, { recursive: true });
    const bytes = JSON.stringify({ name, description: "Owned legacy skill", commands: [{ name: "legacy_CMD.v2", entry: "src/index.ts" }] });
    writeFileSync(join(path, "skill.json"), bytes);
    expect(normalizePortableSkillName("Legacy_Tool.v2")).toBe(name);
    expect(normalizePortableSkillName("OwnedCamelCase")).toBe("ownedcamelcase");
    expect(getPortableSkillPath(name, { rootDir: root })).toBe(path);
    expect(readPortableSkillManifest(path)).toMatchObject({ name, commands: [{ name: "legacy_cmd.v2", entry: "src/index.ts" }] });
    expect(findPortableSkill(name, { rootDir: root })?.path).toBe(path);
    expect(listPortableSkills({ rootDir: root }).map(skill => skill.name)).toEqual([name]);
    scaffoldPortableSkill("legacy_tool.v2", { rootDir: root, kind: "instruction" });
    expect(readFileSync(join(path, "skill.json"), "utf8")).toBe(bytes);
    expect(findPortableSkill(name, { rootDir: root })?.path).toBe(path);
  }));

  test("import naming retains original spelling and source precedence, including explicit overrides", () => fixture((root, sources) => {
    for (const [kind, expected] of [["manifest", "manifest-http-tool"], ["frontmatter", "front-http-tool"], ["package", "package-http-tool"], ["folder", "folder-http-tool"]] as const) {
      const source = join(sources, kind === "folder" ? "FolderHTTPTool" : kind);
      mkdirSync(source);
      if (kind !== "folder") writeFileSync(join(source, "package.json"), JSON.stringify({ name: "PackageHTTPTool", bin: { legacy_cmd: "src/index.ts" } }));
      if (kind === "manifest" || kind === "frontmatter") writeFileSync(join(source, "SKILL.md"), "---\nname: FrontHTTPTool\ndescription: Owned import fixture\n---\n");
      if (kind === "manifest") writeFileSync(join(source, "skill.json"), JSON.stringify({ name: "ManifestHTTPTool" }));
      const before = Object.fromEntries(readdirSync(source).map(file => [file, readFileSync(join(source, file), "utf8")]));
      const result = portPortableSkill(source, { rootDir: root });
      expect(result.name).toBe(expected);
      if (kind !== "folder") expect(result.manifest.commands[0]?.name).toBe("legacy_cmd");
      const renamed = portPortableSkill(source, { rootDir: root, name: `${kind}_Override.Name` });
      expect(renamed.name).toBe(`${kind}-override-name`);
      expect(Object.fromEntries(readdirSync(source).map(file => [file, readFileSync(join(source, file), "utf8")]))).toEqual(before);
    }
  }));

  test("import refusal uses the final canonical name and keeps the source and destination", () => fixture((root, sources) => {
    const source = join(sources, "BrandKit");
    mkdirSync(source);
    const bytes = "---\nname: BrandKit\nkind: instruction\ndescription: Owned fixture\n---\n# Keep this prose\n";
    writeFileSync(join(source, "SKILL.md"), bytes);
    expect(() => portPortableSkill(source, { rootDir: root })).toThrow("shadow");
    expect(() => portPortableSkill(source, { rootDir: root, name: "brand_kit" })).toThrow("shadow");
    expect(() => portPortableSkill(source, { rootDir: root, name: "._-" })).toThrow("Invalid skill name");
    const renamed = portPortableSkill(source, { rootDir: root, name: "OwnedReport" });
    const manifest = readFileSync(join(renamed.path, "skill.json"));
    expect(() => portPortableSkill(source, { rootDir: root, name: "owned_report" })).toThrow("already exists");
    expect(readFileSync(join(renamed.path, "skill.json"))).toEqual(manifest);
    expect(readFileSync(join(source, "SKILL.md"), "utf8")).toBe(bytes);
    expect(portPortableSkill(source, { rootDir: root, allowShadow: true }).name).toBe("brand-kit");
  }));

  test("bulk creation applies the same naming without changing collision accounting", () => fixture((root, sources) => {
    for (const folder of ["BatchName", "batch_name"]) {
      mkdirSync(join(sources, folder));
      writeFileSync(join(sources, folder, "SKILL.md"), "---\nkind: instruction\ndescription: Owned bulk fixture\n---\n");
    }
    const result = portPortableSkillDirectory(sources, { rootDir: root });
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.imported[0]?.name).toBe("batch-name");
    expect(result.skipped[0]?.reason).toContain("already exists");
  }));

  test("instruction renames preserve unrelated copied bytes and validate without fabricated executable files", () => fixture((root, sources) => {
    const source = join(sources, "source");
    mkdirSync(source);
    const prose = '---\r\ndescription: Owned instruction fixture\r\nnotes: name: "QuotedHTTPTool"  \r\nname: "QuotedHTTPTool"  \r\nkind: instruction\r\ntags:\r\n  - owned\r\n---\r\n\r\n# Prose\r\nname: this is body text\r\n';
    const pkg = { name: "QuotedHTTPTool", version: "1.2.3", custom: { retained: true }, bin: { legacy_cmd: "script.ts" } };
    writeFileSync(join(source, "SKILL.md"), prose);
    const packageBytes = JSON.stringify(pkg);
    writeFileSync(join(source, "package.json"), packageBytes);
    for (const [override, expected] of [[undefined, "quoted-http-tool"], ["Explicit_Name", "explicit-name"]] as const) {
      const result = portPortableSkill(source, { rootDir: root, name: override });
      expect(result.name).toBe(expected);
      expect(readFileSync(join(result.path, "SKILL.md"), "utf8")).toBe(prose.replace('\r\nname: "QuotedHTTPTool"', `\r\nname: ${expected}`));
      expect(JSON.parse(readFileSync(join(result.path, "package.json"), "utf8"))).toEqual({ ...pkg, name: expected });
      expect(validatePortableSkillDirectory(expected, result.path).valid).toBe(true);
      expect(readdirSync(result.path).sort()).toEqual(["SKILL.md", "package.json", "skill.json"]);
    }
    expect(readFileSync(join(source, "SKILL.md"), "utf8")).toBe(prose);
    expect(readFileSync(join(source, "package.json"), "utf8")).toBe(packageBytes);
  }));

  test("ambiguous instruction name rewrites fail without modifying the source or copied prose", () => fixture((root, sources) => {
    for (const [index, declarations] of [
      "name: OldName\nname: OtherName", "name: 'UnclosedName", "name: OldName # comment", "  name: NestedName",
    ].entries()) {
      const source = join(sources, `source-${index}`);
      mkdirSync(source);
      const prose = `---\n${declarations}\ndescription: Owned ambiguous fixture\nkind: instruction\n---\n# Prose\n`;
      writeFileSync(join(source, "SKILL.md"), prose);
      expect(() => portPortableSkill(source, { rootDir: root, name: `chosen-name-${index}` })).toThrow("unambiguous top-level name scalar");
      expect(readFileSync(join(source, "SKILL.md"), "utf8")).toBe(prose);
      expect(readFileSync(join(root, `chosen-name-${index}`, "SKILL.md"), "utf8")).toBe(prose);
    }
  }));
});
