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
    expect(() => discoverHarnesses({ env: f.env, overrides: { codex: { configDir: "./relative" } } })).toThrow("absolute");
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
    const env = { ...f.env, CLAUDE_CONFIG_DIR: "~/custom-claude", CODEX_HOME: "~/custom-codex", OPENCODE_CONFIG_DIR: "~/custom-opencode", SUMI_CONFIG_DIR: "~/custom-sumi", XDG_CONFIG_HOME: "~/xdg", SUMI_HOME: "~/sumi-root" };
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
});
