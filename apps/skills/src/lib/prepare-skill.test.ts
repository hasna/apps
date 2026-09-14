import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { prepareSkill } from "./prepare-skill.js";
import { scaffoldPortableSkill, validatePortableSkillDirectory, type SkillKind } from "./portable-skills.js";
import { computeContentHash } from "./skill-hash.js";

useDefaultTestTimeout();

function fixture(run: (root: string, path: string) => void, kind: SkillKind = "executable") {
  const root = mkdtempSync(join(tmpdir(), "skills-prepare-test-"));
  try { run(root, scaffoldPortableSkill("prepare-example", { rootDir: root, kind }).path); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function editManifest(path: string, edit: (manifest: Record<string, any>) => void): string {
  const manifest = JSON.parse(readFileSync(join(path, "skill.json"), "utf8"));
  edit(manifest);
  const bytes = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(join(path, "skill.json"), bytes);
  return bytes;
}

describe("prepare local skill drafts", () => {
  test.each(["mixed-case-directory", "dependency-named-file"])("preserves canonical source input at %s", entry => fixture((root, path) => {
    expect(validatePortableSkillDirectory("prepare-example", path).valid).toBe(true);
    const source = entry === "mixed-case-directory" ? join(path, "src/Node_Modules/fixture.txt") : join(path, "src/node_modules");
    if (entry === "mixed-case-directory") mkdirSync(join(path, "src/Node_Modules"));
    writeFileSync(source, "Reviewed canonical input.\n");
    const before = readFileSync(join(path, "skill.json"), "utf8");
    const preview = prepareSkill("prepare-example", { rootDir: root, version: "0.2.0", dryRun: true });
    expect(preview.written).toBe(false);
    expect(readFileSync(join(path, "skill.json"), "utf8")).toBe(before);
    const prepared = prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" });
    expect(prepared.written).toBe(true);
    expect(prepared.contentHash).toBe(preview.contentHash);
    expect(prepared.contentHash).toBe(computeContentHash(path));
    expect(validatePortableSkillDirectory("prepare-example", path).valid).toBe(true);
    expect(readFileSync(source, "utf8")).toBe("Reviewed canonical input.\n");
    expect(prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" })).toMatchObject({ changed: false, written: false });
    writeFileSync(source, "A later source edit.\n");
    expect(() => prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" })).toThrow("greater");
  }));

  test("ordinary dependency directories stay outside the prepared content hash", () => fixture((root, path) => {
    for (const relative of ["node_modules", "src/node_modules"]) {
      mkdirSync(join(path, relative));
      writeFileSync(join(path, relative, "fixture.txt"), "Disposable dependency bytes.\n");
    }
    const prepared = prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" });
    expect(prepared.contentHash).toBe(computeContentHash(path));
    expect(validatePortableSkillDirectory("prepare-example", path).valid).toBe(true);
    for (const relative of ["node_modules", "src/node_modules"]) {
      expect(readFileSync(join(path, relative, "fixture.txt"), "utf8")).toBe("Disposable dependency bytes.\n");
      writeFileSync(join(path, relative, "fixture.txt"), "Changed dependency bytes.\n");
    }
    expect(prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" })).toMatchObject({ changed: false, written: false });
  }));

  test("mixed-case dependency-like source retains symlink refusal", () => fixture((root, path) => {
    mkdirSync(join(path, "src/Node_Modules"));
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "Owned outside bytes.\n");
    symlinkSync(outside, join(path, "src/Node_Modules/linked.txt"));
    const before = readFileSync(join(path, "skill.json"), "utf8");
    expect(() => prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" })).toThrow("symlink");
    expect(readFileSync(join(path, "skill.json"), "utf8")).toBe(before);
    expect(readFileSync(outside, "utf8")).toBe("Owned outside bytes.\n");
  }));

  test("preserves extension fields, source bytes and manifest mode; does not run author code", () => fixture((root, path) => {
    const marker = join(root, "must-not-run");
    const source = `throw new Error(${JSON.stringify(marker)});\n`;
    writeFileSync(join(path, "src/index.ts"), source);
    editManifest(path, manifest => {
      manifest.extension = { taxonomy: ["authoring"], revision: 7 };
      manifest.runtime.extension = { provider: "self-hosted" };
      manifest.provenance.extension = { reviewed: true };
    });
    chmodSync(join(path, "skill.json"), 0o640);
    chmodSync(join(path, "src/index.ts"), 0o751);
    const previousUmask = process.umask(0o077);
    let result;
    try { result = prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" }); }
    finally { process.umask(previousUmask); }
    expect(result).toMatchObject({ written: true, kind: "executable", version: "0.2.0" });
    expect(JSON.parse(readFileSync(join(path, "skill.json"), "utf8"))).toMatchObject({
      extension: { taxonomy: ["authoring"], revision: 7 },
      runtime: { extension: { provider: "self-hosted" } },
      provenance: { extension: { reviewed: true }, content_hash: computeContentHash(path) },
    });
    expect(readFileSync(join(path, "src/index.ts"), "utf8")).toBe(source);
    expect(statSync(join(path, "skill.json")).mode & 0o777).toBe(0o640);
    expect(statSync(join(path, "src/index.ts")).mode & 0o777).toBe(0o751);
    expect(existsSync(marker)).toBe(false);
    expect(validatePortableSkillDirectory("prepare-example", path).valid).toBe(true);
  }));

  test.each(["failed", "pending"])("author preparation ignores unreadable local %s state and retains nested same-name source", status => fixture((root, path) => {
    const marker = ".skills-dependency-preparation";
    const stateFile = join(path, marker, "state.json");
    mkdirSync(join(path, marker));
    const state = JSON.stringify({ version: 1, status });
    writeFileSync(stateFile, state);
    if (status === "pending") mkdirSync(join(path, marker, "active"));
    const nestedEntry = `src/${marker}/index.ts`;
    mkdirSync(join(path, "src", marker));
    writeFileSync(join(path, nestedEntry), "console.log('authored nested entry');\n");
    editManifest(path, manifest => {
      manifest.commands[0].entry = nestedEntry;
      manifest.runtime.entrypoint = nestedEntry;
    });
    // Local runtime state is not authoring input and need not be readable. The
    // nested directory is real source: candidate entrypoint validation needs it.
    chmodSync(stateFile, 0);
    try {
      expect(prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" }).written).toBe(true);
      expect(validatePortableSkillDirectory("prepare-example", path).valid).toBe(true);
      expect(readFileSync(join(path, nestedEntry), "utf8")).toBe("console.log('authored nested entry');\n");
    } finally { chmodSync(stateFile, 0o600); }
    expect(readFileSync(stateFile, "utf8")).toBe(state);
    expect(existsSync(join(path, marker, "active"))).toBe(status === "pending");
  }));

  test("legacy kind-less helper scripts require explicit author intent", () => fixture((root, path) => {
    const before = editManifest(path, manifest => { delete manifest.kind; });
    expect(() => prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" })).toThrow("no explicit kind");
    expect(readFileSync(join(path, "skill.json"), "utf8")).toBe(before);
    const result = prepareSkill("prepare-example", { rootDir: root, version: "0.2.0", kind: "instruction" });
    expect(result.kind).toBe("instruction");
    expect(existsSync(join(path, "src/index.ts"))).toBe(true);
    expect(validatePortableSkillDirectory("prepare-example", path).valid).toBe(true);
  }));

  test("kind conversion requires aligned frontmatter and the complete executable contract", () => fixture((root, path) => {
    mkdirSync(join(path, "src"));
    writeFileSync(join(path, "src/index.ts"), "console.log('converted example');\n");
    writeFileSync(join(path, "AGENTS.md"), "Reviewed executable author instructions.\n");
    const before = editManifest(path, manifest => {
      manifest.inputs = [{ name: "args", type: "string[]" }];
      manifest.commands = [{ name: "prepare-example", entry: "src/index.ts" }];
    });
    const document = readFileSync(join(path, "SKILL.md"), "utf8");
    expect(() => prepareSkill("prepare-example", { rootDir: root, version: "0.2.0", kind: "executable" })).toThrow("SKILL.md kind");
    expect(readFileSync(join(path, "skill.json"), "utf8")).toBe(before);
    expect(readFileSync(join(path, "SKILL.md"), "utf8")).toBe(document);
    const aligned = document.replace("kind: instruction", "kind: executable");
    writeFileSync(join(path, "SKILL.md"), aligned);
    expect(() => prepareSkill("prepare-example", { rootDir: root, version: "0.2.0", kind: "executable" })).toThrow("package.missing");
    expect(readFileSync(join(path, "skill.json"), "utf8")).toBe(before);
    writeFileSync(join(path, "package.json"), JSON.stringify({ name: "prepare-example", version: "0.2.0", bin: { "prepare-example": "src/index.ts" } }));
    expect(prepareSkill("prepare-example", { rootDir: root, version: "0.2.0", kind: "executable" })).toMatchObject({ kind: "executable", written: true });
    expect(readFileSync(join(path, "SKILL.md"), "utf8")).toBe(aligned);
    expect(validatePortableSkillDirectory("prepare-example", path).valid).toBe(true);
  }, "instruction"));

  test.each(["0.1.0", "0.0.9", "0.1.0+changed", "0.1.0-preview", "01.2.0", "latest"])("refuses changed content at invalid/non-increasing version %s", version => fixture((root, path) => {
    writeFileSync(join(path, "src/index.ts"), "console.log('edited');\n");
    const before = readFileSync(join(path, "skill.json"), "utf8");
    expect(() => prepareSkill("prepare-example", { rootDir: root, version })).toThrow();
    expect(readFileSync(join(path, "skill.json"), "utf8")).toBe(before);
  }));

  test("semver prerelease ordering handles numeric identifiers", () => fixture((root, path) => {
    editManifest(path, manifest => { manifest.version = "0.2.0-rc.9"; });
    expect(prepareSkill("prepare-example", { rootDir: root, version: "0.2.0-rc.10" }).written).toBe(true);
    expect(() => prepareSkill("prepare-example", { rootDir: root, version: "0.2.0-rc.2" })).toThrow("greater");
    expect(prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" }).written).toBe(true);
  }));

  test.each(["runtime", "commands", "name", "kind", "provenance"])("refuses malformed raw %s without compatibility coercion or source changes", field => fixture((root, path) => {
    const before = editManifest(path, manifest => {
      if (field === "runtime") manifest.runtime.env = [42];
      else if (field === "commands") manifest.commands[0].args = [false];
      else if (field === "name") delete manifest.name;
      else manifest[field] = "invalid";
    });
    expect(() => prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" })).toThrow();
    expect(readFileSync(join(path, "skill.json"), "utf8")).toBe(before);
  }));

  test("missing command entrypoint fails before writing the candidate manifest", () => fixture((root, path) => {
    const before = editManifest(path, manifest => { manifest.commands[0].entry = "src/missing.ts"; });
    expect(() => prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" })).toThrow("cannot be prepared");
    expect(readFileSync(join(path, "skill.json"), "utf8")).toBe(before);
  }));

  test.each(["../outside.ts", "/tmp/outside.ts", "src/missing.ts", "src"])("refuses invalid executable runtime entrypoint %s before changing the manifest", entrypoint => fixture((root, path) => {
    const before = editManifest(path, manifest => { manifest.runtime.entrypoint = entrypoint; });
    expect(() => prepareSkill("prepare-example", { rootDir: root, version: "0.2.0" })).toThrow("runtime.entrypoint");
    expect(readFileSync(join(path, "skill.json"), "utf8")).toBe(before);
  }));

  test.each(["root", "manifest", "resource"])("refuses a symlink at %s before following it", location => fixture((root, path) => {
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "resource.md"), "Outside authoring root.\n");
    let name = "prepare-example";
    if (location === "root") { symlinkSync(path, join(root, "alias")); name = "alias"; }
    else if (location === "manifest") { rmSync(join(path, "skill.json")); symlinkSync(join(outside, "resource.md"), join(path, "skill.json")); }
    else { mkdirSync(join(path, "references"), { recursive: true }); symlinkSync(join(outside, "resource.md"), join(path, "references/link.md")); }
    expect(() => prepareSkill(name, { rootDir: root, version: "0.2.0" })).toThrow("symlink");
    expect(readFileSync(join(outside, "resource.md"), "utf8")).toBe("Outside authoring root.\n");
  }));

  test("dry-run does not create or migrate a legacy corpus", () => {
    const home = mkdtempSync(join(tmpdir(), "skills-prepare-no-migrate-"));
    try {
      scaffoldPortableSkill("prepare-example", { rootDir: join(home, ".hasna/skills/custom") });
      expect(() => prepareSkill("prepare-example", { homeDir: home, version: "0.2.0", dryRun: true })).toThrow();
      expect(existsSync(join(home, ".hasna/skills/installed"))).toBe(false);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
