import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverHarnesses } from "./harness-discovery.js";
import { makeTempRoot } from "./test-temp-root.js";
import { detectMachineContext, machineContextToVariables, renderMachineAwareContent } from "./machine.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const home = makeTempRoot("instructions-harness-paths-"); roots.push(home);
  const bin = join(home, "bin"); mkdirSync(bin);
  const executable = (name: string) => { const path = join(bin, name); writeFileSync(path, "#!/bin/sh\nexit 88\n", { mode: 0o700 }); return path; };
  return { home, bin, executable, env: { HOME: home, PATH: bin } };
}

describe("read-only portable harness discovery", () => {
  test("finds executable symlinks without running commands or creating missing config homes", () => {
    const f = fixture();
    const actual = f.executable("actual"); symlinkSync(actual, join(f.bin, "claude"));
    writeFileSync(actual, `#!/bin/sh\ntouch '${join(f.home, "executed")}'\n`, { mode: 0o700 });
    const result = discoverHarnesses({ env: f.env });
    const claude = result.tools[0]!;
    expect(claude.status).toBe("executable-found");
    expect(claude.executable).toMatchObject({ path: join(f.bin, "claude"), realPath: actual, symlink: true });
    expect(claude.versionEvidence).toBe("not-probed");
    expect(claude.config).toMatchObject({ path: join(f.home, ".claude"), source: "native-default", state: "missing" });
    expect(result.tools[1]!.status).toBe("absent");
    expect(result.templateVariables.CLAUDE_EXECUTABLE).toBe(join(f.bin, "claude"));
    expect(result.templateVariables.CODEX_EXECUTABLE).toBeUndefined();
    expect(result.templateVariables.CODEX_CONFIG_DIR).toBeUndefined();
    expect(existsSync(join(f.home, "executed"))).toBe(false);
    expect(existsSync(join(f.home, ".claude"))).toBe(false);
    expect(existsSync(join(f.home, ".hasna"))).toBe(false);
  });

  test("owner-home and explicit config override precede env; relative PATH is not searched", () => {
    const f = fixture(); f.executable("codex");
    const result = discoverHarnesses({ ownerHome: f.home, env: { HOME: "/different-owner", PATH: ".:", CODEX_HOME: "/native-env" }, overrides: { codex: { executable: "~/bin/codex", configDir: "{{HOME_DIR}}/selected" } } });
    expect(result.ownerHome.path).toBe(f.home);
    expect(result.tools[1]!.config).toMatchObject({ path: join(f.home, "selected"), source: "override" });
    expect(result.tools[1]!.executableSource).toBe("override");
    expect(result.tools[0]!.status).toBe("absent");
    expect(result.tools[0]!.diagnostics.join(" ")).toContain("Relative or empty PATH entries");
    expect(() => discoverHarnesses({ env: f.env, overrides: { codex: { configDir: "relative" } } })).toThrow("absolute");
  });

  test("invalid explicit executable does not fall back to another PATH installation", () => {
    const f = fixture(); const executable = f.executable("codex");
    const result = discoverHarnesses({ env: f.env, overrides: { codex: { executable: join(f.home, "missing") } } });
    expect(result.tools[1]!.status).toBe("absent");
    expect(result.tools[1]!.diagnostics.join(" ")).toContain("fallback is disabled");
    chmodSync(executable, 0o600);
    expect(discoverHarnesses({ env: f.env }).tools[1]!.status).toBe("absent");
  });

  test("native env selectors and Sumi XDG-before-home precedence are explicit", () => {
    const f = fixture();
    const env = { ...f.env, CLAUDE_CONFIG_DIR: join(f.home, "custom-claude"), CODEX_HOME: join(f.home, "custom-codex"), OPENCODE_CONFIG_DIR: join(f.home, "custom-opencode"), SUMI_CONFIG_DIR: join(f.home, "custom-sumi"), XDG_CONFIG_HOME: join(f.home, "xdg"), SUMI_HOME: join(f.home, "sumi-root") };
    for (const tool of ["claude", "codex", "opencode", "sumi"]) f.executable(tool);
    const result = discoverHarnesses({ env });
    for (const entry of result.tools) expect(entry.config!.path).toBe(join(f.home, `custom-${entry.tool}`));
    expect(discoverHarnesses({ env: { ...env, SUMI_CONFIG_DIR: undefined } }).tools[3]!.config).toMatchObject({ path: join(f.home, "xdg/sumi"), source: "XDG_CONFIG_HOME" });
    expect(discoverHarnesses({ env: { ...env, SUMI_CONFIG_DIR: undefined, XDG_CONFIG_HOME: undefined } }).tools[3]!.config).toMatchObject({ path: join(f.home, "sumi-root/config"), source: "SUMI_HOME" });
    expect(discoverHarnesses({ env: f.env }).tools[3]!.config).toBeNull();
    expect(discoverHarnesses({ env: f.env }).tools[3]!.diagnostics.join(" ")).toContain("sumi debug paths config");
  });

  test("project prompt symlinks preserve lexical paths and flag scope review without reading bodies", () => {
    const f = fixture(); f.executable("codex");
    const project = join(f.home, "project"); mkdirSync(project);
    const prompt = join(project, "AGENTS.md"); writeFileSync(prompt, "PRIVATE_PROJECT_RULES");
    mkdirSync(join(f.home, ".codex")); symlinkSync(prompt, join(f.home, ".codex/AGENTS.md"));
    const result = discoverHarnesses({ env: f.env, projectRoot: "~/project", overrides: { sumi: { configDir: "~/sumi-global" } } });
    expect(result.tools[1]!.scopeReviewRequired).toBe(true);
    expect(result.tools[1]!.globalPrompt).toMatchObject({ path: join(f.home, ".codex/AGENTS.md"), realPath: prompt, symlink: true });
    expect(result.tools[3]!.config!.path).toBe(join(f.home, "sumi-global"));
    expect(result.tools[3]!.projectPrompt!.path).toBe(prompt);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROJECT_RULES");
    expect(readFileSync(prompt, "utf8")).toBe("PRIVATE_PROJECT_RULES");
  });

  test("config parent symlinks and dangling prompt links are not silently flattened", () => {
    const f = fixture(); const elsewhere = join(f.home, "elsewhere"); mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(f.home, ".claude"));
    symlinkSync(join(f.home, "absent"), join(elsewhere, "CLAUDE.md"));
    const result = discoverHarnesses({ env: f.env });
    expect(result.tools[0]!.scopeReviewRequired).toBe(true);
    expect(result.tools[0]!.config!.path).toBe(join(f.home, ".claude"));
    expect(result.tools[0]!.config!.realPath).toBe(elsewhere);
    expect(result.tools[0]!.globalPrompt!.state).toBe("dangling-symlink");
  });

  test("unconfigured workspace stays unresolved instead of inventing a directory", () => {
    const f = fixture(); const machine = detectMachineContext({ home_dir: f.home });
    expect(machine.workspace_root).toBe("");
    expect(machineContextToVariables(machine)).not.toHaveProperty("WORKSPACE_ROOT");
    expect(() => renderMachineAwareContent("{{WORKSPACE_ROOT}}/repo", machineContextToVariables(machine))).toThrow("Missing required");
  });

  test("a missing config below a linked parent still requires scope review", () => {
    const f = fixture(); const project = join(f.home, "project-configs"); mkdirSync(project);
    symlinkSync(project, join(f.home, ".config"));
    const result = discoverHarnesses({ env: f.env });
    expect(result.tools[2]!.config).toMatchObject({ state: "missing", viaSymlink: true });
    expect(result.tools[2]!.globalPrompt).toMatchObject({ state: "missing", viaSymlink: true });
    expect(result.tools[2]!.scopeReviewRequired).toBe(true);
    expect(existsSync(join(project, "opencode"))).toBe(false);
  });

  test("rejects dot segments before resolving symlinks and ignores ambiguous PATH entries", () => {
    const f = fixture(); f.executable("codex");
    const elsewhere = join(f.home, "elsewhere"); mkdirSync(join(elsewhere, "nested"), { recursive: true });
    symlinkSync(join(elsewhere, "nested"), join(f.home, "link"));
    const ambiguous = `${f.home}/link/../config`;
    expect(() => discoverHarnesses({ env: f.env, overrides: { codex: { configDir: ambiguous } } })).toThrow("dot segments");
    expect(() => discoverHarnesses({ env: f.env, projectRoot: "~/link/../config" })).toThrow("dot segments");
    const result = discoverHarnesses({ env: { ...f.env, PATH: `${f.home}/link/../../bin`, CODEX_HOME: ambiguous } });
    expect(result.tools[1]!.config).toBeNull();
    expect(result.tools[1]!.status).toBe("absent");
    expect(result.tools[1]!.diagnostics.join(" ")).toContain("ambiguous PATH");
  });

  test("does not expand native env placeholders or guess a default for ambiguous selectors", () => {
    const f = fixture();
    for (const value of ["~/literal", "${HOME}/literal", "{{HOME_DIR}}/literal", "relative", " "]) {
      const result = discoverHarnesses({ env: { ...f.env, CODEX_HOME: value, OPENCODE_CONFIG_DIR: value } });
      expect(result.tools[1]!.config).toBeNull();
      expect(result.tools[2]!.config).toBeNull();
      expect(result.tools[1]!.diagnostics.join(" ")).toContain("CODEX_HOME is present");
    }
    const empty = discoverHarnesses({ env: { ...f.env, CODEX_HOME: "", OPENCODE_CONFIG_DIR: "" } });
    expect(empty.tools[1]!.config!.source).toBe("native-default");
    expect(empty.tools[2]!.config).toBeNull();
    expect(discoverHarnesses({ env: f.env, overrides: { codex: { configDir: "~/portable" } } }).tools[1]!.config!.path).toBe(join(f.home, "portable"));
  });

  test("Codex override candidates cannot hide linked project scope or pretend AGENTS.md is effective", () => {
    const f = fixture(); mkdirSync(join(f.home, ".codex"));
    const project = join(f.home, "project"); mkdirSync(project);
    writeFileSync(join(project, "AGENTS.override.md"), "PRIVATE_OVERRIDE_RULES");
    symlinkSync(join(project, "AGENTS.override.md"), join(f.home, ".codex/AGENTS.override.md"));
    const result = discoverHarnesses({ env: f.env, projectRoot: project });
    const codex = result.tools[1]!;
    expect(codex.globalPrompt!.path).toBe(join(f.home, ".codex/AGENTS.md"));
    expect(codex.promptOverrides).toHaveLength(2);
    expect(codex.promptOverrides[0]).toMatchObject({ symlink: true, realPath: join(project, "AGENTS.override.md") });
    expect(codex.scopeReviewRequired).toBe(true);
    expect(codex.diagnostics.join(" ")).toContain("may take precedence");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_OVERRIDE_RULES");
  });
});
