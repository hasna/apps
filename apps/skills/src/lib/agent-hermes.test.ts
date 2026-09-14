import { afterEach, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyAgentIntegration, archiveNativeSkills, assertManagedAgentBridge, inventoryNativeSkills, planAgentIntegration } from "./agent-integration.js";
import { hermesHookDefinitions, normalizeHermesHookInput, assertHermesTool, parseHermesConfig, renderHermesSupervisor, assertNoHermesLegacyShadow } from "./agent-hermes.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-hermes-")); roots.push(home);
  const dataDir = join(home, ".hasna/skills"); mkdirSync(dataDir, { recursive: true });
  return { home, dataDir, agents: ["hermes"] as const, command: "/opt/Skills CLI/bin/skills", profileId: "engineering" };
}
function put(path: string, content: string) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content); }
function install(f: ReturnType<typeof fixture>) { return applyAgentIntegration(planAgentIntegration({ ...f, agents: [...f.agents] })); }
function trust(f: ReturnType<typeof fixture>) {
  const approvals = Object.entries(hermesHookDefinitions({ runtime: process.execPath, path: join(f.dataDir, "agent-hooks/hermes.js") })).map(([event, entry]) => ({ event, command: entry.command }));
  put(join(f.home, ".hermes/shell-hooks-allowlist.json"), JSON.stringify({ approvals }));
}
function check(f: ReturnType<typeof fixture>) { assertManagedAgentBridge("hermes", { ...f, projectDir: f.home }); }

test("Hermes planning preserves unrelated YAML/comments and native trust, opts out of reseeding, and is idempotent", () => {
  const f = fixture(), path = join(f.home, ".hermes/config.yaml");
  const before = '# Existing model configuration\nmodel:\n  default: fixture-model\nskills:\n  inline_shell: false\nhooks:\n  post_tool_call:\n    - command: preserve-hook\n'; put(path, before);
  const plan = planAgentIntegration({ ...f, agents: [...f.agents] });
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(existsSync(join(f.home, ".hermes/.no-bundled-skills"))).toBe(false);
  const result = applyAgentIntegration(plan), after = readFileSync(path, "utf8"), config = parseHermesConfig(after);
  expect(after).toContain("# Existing model configuration");
  expect(config.model).toEqual({ default: "fixture-model" });
  expect(config.skills).toEqual({ inline_shell: false });
  expect(config.hooks.post_tool_call).toEqual([{ command: "preserve-hook" }]);
  expect(config.hooks.pre_tool_call[0].fail_closed).toBe(true);
  expect(config.hooks.pre_llm_call[0].fail_closed).toBeUndefined();
  expect(result.backups.some(path => readFileSync(path, "utf8") === before)).toBe(true);
  expect(existsSync(join(f.home, ".hermes/skills/skills-cli/SKILL.md"))).toBe(true);
  expect(existsSync(join(f.home, ".hermes/shell-hooks-allowlist.json"))).toBe(false);
  expect(() => check(f)).toThrow("trust"); trust(f); expect(() => check(f)).not.toThrow();
  expect(planAgentIntegration({ ...f, agents: [...f.agents] }).changes).toEqual([]);
});

test("Hermes requires exact native event/command trust and opt-out on every guard", () => {
  const f = fixture(); install(f); trust(f); check(f);
  put(join(f.home, ".hermes/shell-hooks-allowlist.json"), JSON.stringify({ approvals: [{ event: "pre_llm_call", command: "different-command" }] }));
  expect(() => check(f)).toThrow("trust"); trust(f);
  rmSync(join(f.home, ".hermes/.no-bundled-skills"));
  expect(() => check(f)).toThrow("reseeding");
});

test("Hermes native payloads including hidden discovery are guarded and preserved by explicit retirement", () => {
  const f = fixture(), path = join(f.home, ".hermes/skills/.local/review/SKILL.md"); put(path, "Native instructions\n");
  install(f); trust(f); expect(() => check(f)).toThrow("native skill copies");
  const receipt = archiveNativeSkills(inventoryNativeSkills(f.home), { dataDir: f.dataDir, includeUnmanaged: true });
  expect(receipt.entries).toHaveLength(1);
  expect(readFileSync(join(receipt.entries[0]!.archive, "SKILL.md"), "utf8")).toBe("Native instructions\n");
  check(f);
});

test("Hermes external skill paths and shared project paths cannot bypass inventory", () => {
  const f = fixture(), external = join(f.home, "external");
  put(join(external, "review/SKILL.md"), "External instructions\n");
  put(join(f.home, ".hermes/config.yaml"), `skills:\n  external_dirs: ${JSON.stringify(external)}\n`);
  const plan = planAgentIntegration({ ...f, agents: [...f.agents] }); expect(plan.nativeSkills.some(entry => entry.path === join(external, "review"))).toBe(true);
  applyAgentIntegration(plan); trust(f); expect(() => check(f)).toThrow("native skill copies");
  rmSync(external, { recursive: true }); put(join(f.home, ".agents/skills/project/SKILL.md"), "Shared instructions\n");
  expect(() => check(f)).toThrow("native skill copies");
});

test("Hermes unsupported runtime plugins require reviewed source bindings", () => {
  const f = fixture(); mkdirSync(join(f.home, ".hermes/hermes-agent/plugins"), { recursive: true });
  expect(() => planAgentIntegration({ ...f, agents: [...f.agents] })).toThrow("reviewed");
});

for (const yaml of ["hooks: []\n", "hooks:\n  pre_llm_call: nope\n", "skills: []\n", "model: a\nmodel: b\n", "hooks: &shared {}\nother: *shared\n"]) test(`Hermes malformed or aliased YAML refuses before writes (${yaml.length})`, () => {
  const f = fixture(); put(join(f.home, ".hermes/config.yaml"), yaml);
  expect(() => install(f)).toThrow(); expect(existsSync(join(f.home, ".hermes/skills/skills-cli"))).toBe(false);
});

test("Hermes changed config and symlink opt-out refuse the whole plan before writes", () => {
  const f = fixture(), path = join(f.home, ".hermes/config.yaml"); put(path, "model: fixture\n");
  const plan = planAgentIntegration({ ...f, agents: [...f.agents] }); put(path, "model: changed\n");
  expect(() => applyAgentIntegration(plan)).toThrow("changed"); expect(existsSync(join(f.home, ".hermes/skills/skills-cli"))).toBe(false);
  symlinkSync(join(f.home, "missing"), join(f.home, ".hermes/.no-bundled-skills"));
  expect(() => install(f)).toThrow("symlink");
});

test("Hermes actual payload normalization maps nested user context and first turn without trusting a fake top-level prompt", () => {
  expect(normalizeHermesHookInput({ hook_event_name: "pre_llm_call", session_id: "session-a", cwd: "/project", prompt: "ignored", extra: { user_message: "$review", is_first_turn: true } })).toMatchObject({ prompt: "$review", hook_event_name: "SessionStart", session_id: "session-a", cwd: "/project" });
  expect(normalizeHermesHookInput({ hook_event_name: "pre_llm_call", extra: { user_message: "continue", is_first_turn: false } }).hook_event_name).toBe("UserPromptSubmit");
  for (const extra of [undefined, [], { user_message: 42 }, { user_message: "ok", is_first_turn: "true" }]) expect(() => normalizeHermesHookInput({ hook_event_name: "pre_llm_call", extra })).toThrow();
});

test("Hermes pre-tool guard allows only the owned native bridge and keeps unrelated tools available", () => {
  expect(() => assertHermesTool({ tool_name: "skill_view", tool_input: { name: "skills-cli" } })).not.toThrow();
  expect(() => assertHermesTool({ tool_name: "terminal", tool_input: { command: "echo fixture" } })).not.toThrow();
  for (const input of [{ tool_name: "skill_view", tool_input: { name: "review" } }, { tool_name: "skill_view", tool_input: { name: "plugin:skills-cli" } }, { tool_name: "skill_manage", tool_input: { action: "create", name: "skills-cli" } }, { tool_name: "skill_view", tool_input: {} }, {}]) expect(() => assertHermesTool(input)).toThrow();
});

test("Hermes custom profiles, project plugin activation and active-profile drift refuse before native loading", () => {
  const f = fixture(); install(f); trust(f);
  const oldHome = process.env.HERMES_HOME, oldPlugins = process.env.HERMES_ENABLE_PROJECT_PLUGINS;
  try {
    process.env.HERMES_HOME = join(f.home, ".hermes/profiles/other"); expect(() => check(f)).toThrow("custom Hermes");
    process.env.HERMES_HOME = join(f.home, ".hermes"); check(f);
    process.env.HERMES_ENABLE_PROJECT_PLUGINS = " TRUE "; expect(() => check(f)).toThrow("project plugins");
    delete process.env.HERMES_ENABLE_PROJECT_PLUGINS;
    put(join(f.home, ".hermes/active_profile"), "other\n"); expect(() => check(f)).toThrow("discovery input changed");
  } finally {
    if (oldHome === undefined) delete process.env.HERMES_HOME; else process.env.HERMES_HOME = oldHome;
    if (oldPlugins === undefined) delete process.env.HERMES_ENABLE_PROJECT_PLUGINS; else process.env.HERMES_ENABLE_PROJECT_PLUGINS = oldPlugins;
  }
});

test("Hermes config uses native YAML1.1 scalar semantics and rejects disabled bridge/platform drift", () => {
  expect(parseHermesConfig("skills:\n  inline_shell: off\n").skills.inline_shell).toBe(false);
  for (const yaml of ["skills:\n  disabled: [skills-cli]\n", "skills:\n  platform_disabled:\n    cli: [skills-cli]\n", "skills:\n  platform_disabled: nope\n"]) {
    const f = fixture(); put(join(f.home, ".hermes/config.yaml"), yaml); install(f); trust(f); expect(() => check(f)).toThrow();
  }
});

test("Hermes reinstallation preserves semantic hook key ordering but refuses changed protected definitions", () => {
  const f = fixture(); install(f); trust(f);
  const path = join(f.home, ".hermes/config.yaml"), config = parseHermesConfig(readFileSync(path, "utf8"));
  const current = config.hooks.pre_tool_call[0]; config.hooks.pre_tool_call[0] = { fail_closed: current.fail_closed, timeout: current.timeout, command: current.command };
  put(path, JSON.stringify(config));
  // A replan binds the freshly reviewed discovery hash; no trust entry changes.
  install(f); check(f);
  const edited = parseHermesConfig(readFileSync(path, "utf8")); edited.hooks.pre_tool_call[0].fail_closed = false; put(path, JSON.stringify(edited));
  expect(() => install(f)).toThrow("Modified Hermes");
});

test("Hermes matches native external-dir whitespace/tilde roots and refuses unsupported user expansion", () => {
  const f = fixture(), external = join(f.home, "external"); put(join(external, "review/SKILL.md"), "External fixture\n");
  put(join(f.home, ".hermes/config.yaml"), `skills:\n  external_dirs: [${JSON.stringify(` ${external} `)}, " ~/external "]\n`);
  const plan = planAgentIntegration({ ...f, agents: [...f.agents] }); expect(plan.nativeSkills.filter(entry => entry.path === join(external, "review"))).toHaveLength(1);
  put(join(f.home, ".hermes/config.yaml"), 'skills:\n  external_dirs: ["~other/skills"]\n');
  expect(() => install(f)).toThrow("tilde");
});

test("Hermes refuses TERMINAL_CWD instead of certifying a different trusted project", () => {
  const f = fixture(), previous = process.env.TERMINAL_CWD;
  try { process.env.TERMINAL_CWD = join(f.home, "other-project"); expect(() => install(f)).toThrow("TERMINAL_CWD"); }
  finally { if (previous === undefined) delete process.env.TERMINAL_CWD; else process.env.TERMINAL_CWD = previous; }
});

for (const variable of ["HERMES_BUNDLED_PLUGINS", "HERMES_BUNDLED_SKILLS"] as const) {
  test(`Hermes refuses ${variable} during discovery and after bridge installation`, () => {
    const f = fixture(), previous = process.env[variable];
    try {
      delete process.env[variable]; install(f); trust(f); check(f);
      const configPath = join(f.home, ".hermes/config.yaml"), before = readFileSync(configPath, "utf8");
      for (const value of [join(f.home, "unreviewed-bundle"), "relative-bundle", " "]) {
        process.env[variable] = value;
        expect(() => planAgentIntegration({ ...f, agents: [...f.agents] })).toThrow(variable);
        expect(() => inventoryNativeSkills(f.home, { configured: true })).toThrow(variable);
        expect(() => check(f)).toThrow(variable);
        expect(readFileSync(configPath, "utf8")).toBe(before);
      }
      process.env[variable] = "";
      expect(() => check(f)).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;
    }
  });
}

for (const root of [".hermes/skills", ".agents/skills"]) test(`Hermes refuses nested legacy flat bridge shadow in ${root}`, () => {
  const f = fixture(); install(f); trust(f); check(f);
  put(join(f.home, root, "nested/skills-cli.md"), "Legacy shadow instructions\n");
  expect(() => check(f)).toThrow("legacy Hermes");
});

test("Hermes owns the supervisor bytes and refuses modified or foreign launchers", () => {
  const f = fixture(), path = join(f.dataDir, "agent-hooks/hermes.js");
  put(path, "Foreign code\n"); expect(() => install(f)).toThrow("unrecognized Hermes supervisor");
  rmSync(path); install(f); trust(f); check(f); put(path, "Modified code\n");
  expect(() => check(f)).toThrow("supervisor changed"); expect(() => install(f)).toThrow("unrecognized Hermes supervisor");
});

test("Hermes supervisor converts observed child failures and missing directives into native exit2 blocks", async () => {
  const f = fixture(), command = join(f.home, "fixture-cli"), supervisor = join(f.home, "supervisor.js");
  const failures = ["process.exit(1)", 'process.stdout.write("{}"); process.exit(1)', 'process.stdout.write("")', 'process.stdout.write("{}")', 'process.stdout.write("not-json")', 'process.stdout.write("x".repeat(70000))', 'process.stdout.write(JSON.stringify({action:"modify",tool_input:{}}))', 'process.stdout.write(JSON.stringify({action:"continue",decision:"modify",tool_input:{name:"unselected"}}))'];
  for (const body of [...failures, 'process.stdout.write(JSON.stringify({action:"continue"}))', 'process.stdout.write(JSON.stringify({action:"block",message:"Fixture refusal"}))']) {
    put(command, `#!${process.execPath}\n${body}\n`); chmodSync(command, 0o700); put(supervisor, renderHermesSupervisor(command, "engineering"));
    const child = Bun.spawn([process.execPath, supervisor, "--event", "pre_tool_call"], { stdin: new Blob(["{}"]), stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(stderr).toBe(""); const output = JSON.parse(stdout);
      if (failures.includes(body)) { expect(exitCode).toBe(2); expect(output.action).toBe("block"); }
      else { expect(exitCode).toBe(0); expect(["continue", "block"]).toContain(output.action); }
    } finally { clearTimeout(timeout); }
  }
  put(supervisor, renderHermesSupervisor(join(f.home, "missing-cli"), "engineering"));
  const child = Bun.spawn([process.execPath, supervisor, "--event", "pre_tool_call"], { stdin: new Blob(["{}"]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(stderr).toBe(""); expect(exitCode).toBe(2); expect(JSON.parse(stdout).action).toBe("block");
});

test("Hermes supervisor enforces its child deadline and preserves the explicit blocking directive", async () => {
  const f = fixture(), command = join(f.home, "fixture-cli"), supervisor = join(f.home, "supervisor.js");
  put(command, `#!${process.execPath}\nawait Bun.sleep(30000);\n`); chmodSync(command, 0o700); put(supervisor, renderHermesSupervisor(command, "engineering"));
  const start = Date.now(), child = Bun.spawn([process.execPath, supervisor, "--event", "pre_tool_call"], { stdin: new Blob(["{}"]), stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 16000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe(""); expect(exitCode).toBe(2); expect(JSON.parse(stdout).action).toBe("block"); expect(Date.now() - start).toBeLessThan(15000);
  } finally { clearTimeout(timeout); }
});

test("Hermes supervisor stops inherited-pipe descendants after their leader exits", async () => {
  const f = fixture(), command = join(f.home, "fixture-cli"), supervisor = join(f.home, "supervisor.js"), pidFile = join(f.home, "descendant.pid");
  put(command, `#!${process.execPath}\nimport {spawn} from "node:child_process"; import {writeFileSync} from "node:fs"; const child=spawn("/bin/sleep",["30"],{stdio:["ignore","inherit","inherit"]});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.exit(1);\n`);
  chmodSync(command, 0o700); put(supervisor, renderHermesSupervisor(command, "engineering"));
  const child = Bun.spawn([process.execPath, supervisor, "--event", "pre_tool_call"], { stdin: new Blob(["{}"]), stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 16000);
  let pid: number | undefined;
  function running(value: number): boolean {
    try {
      if (process.platform === "linux" && readFileSync(`/proc/${value}/stat`, "utf8").split(") ")[1]?.startsWith("Z")) return false;
      process.kill(value, 0); return true;
    } catch (error) { if (["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) return false; throw error; }
  }
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe(""); expect(exitCode).toBe(2); expect(JSON.parse(stdout).action).toBe("block");
    pid = Number(readFileSync(pidFile, "utf8")); expect(Number.isInteger(pid) && pid > 1).toBe(true);
    for (let i = 0; i < 50 && running(pid); i++) await Bun.sleep(20);
    expect(running(pid)).toBe(false);
  } finally { clearTimeout(timeout); if (pid && running(pid)) process.kill(pid, "SIGKILL"); }
});

for (const path of [".agents/skills/.local/skills-cli.md", ".hermes/skills/node_modules/skills-cli.md"]) test(`Hermes legacy guard covers native rglob descendants: ${path}`, () => {
  const f = fixture(); install(f); trust(f); check(f);
  put(join(f.home, path), "Hidden legacy bridge shadow\n"); expect(() => check(f)).toThrow("legacy Hermes");
});

test("Hermes shared hidden SKILL roots are inventoried without changing other agents", () => {
  const f = fixture(); install(f); trust(f); check(f); put(join(f.home, ".agents/skills/.local/review/SKILL.md"), "Hidden native instructions\n");
  expect(() => check(f)).toThrow("native skill copies");
  expect(inventoryNativeSkills(f.home).some(entry => entry.path.includes("/.local/"))).toBe(false);
});

test("Hermes legacy scan preserves real skill support data while refusing incomplete scans", () => {
  const f = fixture(), skill = join(f.home, "fixture-skill"); put(join(skill, "SKILL.md"), "Fixture\n");
  put(join(skill, "references/archived/skills-cli.md"), "Support data, never a native alias\n");
  expect(() => assertNoHermesLegacyShadow(skill)).not.toThrow();
  const deep = join(f.home, "deep", ...Array.from({ length: 66 }, (_, i) => `d${i}`)); mkdirSync(deep, { recursive: true });
  expect(() => assertNoHermesLegacyShadow(join(f.home, "deep"))).toThrow("discovery limit");
  const linked = join(f.home, "linked"); mkdirSync(linked); symlinkSync(skill, join(linked, "outside"));
  expect(() => assertNoHermesLegacyShadow(linked)).toThrow("symlink");
});
