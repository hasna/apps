import {describe, expect, test} from "bun:test";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {homedir} from "node:os";
import {join} from "node:path";
import {codexAgentsFromEffectiveConfig, compileCodexModelPolicy, prepareCodexModelPolicy, renderCodexAgentToml, writeCodexAgentOverrides} from "../src/codex-model-policy";

describe("Codex model policy", () => {
  test("pins main, default subagent and review while preserving native role fields", () => {
    const result = compileCodexModelPolicy({
      model: "anthropic/opus",
      policy: {roles: {subagent: "openai/subagent", review: "openai/review"}},
      switcherProvider: "switcher", switcherBaseUrl: "http://127.0.0.1:4310/v1",
      agents: {research: {description: "Keep this description", trusted: true, config: {instructions: ["native.md"], permissions: {read: "allow"}}}, review: {trusted: true, config: {model: "foreign/model", tools: {shell: true}}}},
    });
    expect(result.overrides).toEqual({model: "anthropic/opus", model_provider: "switcher", "agents.default_subagent_model": "openai/subagent", review_model: "openai/review"});
    expect(result.agents[0]?.config).toMatchObject({instructions: ["native.md"], permissions: {read: "allow"}, model: "openai/subagent", model_provider: "switcher"});
    expect(result.agents[1]?.config).toMatchObject({model: "openai/review", model_provider: "switcher", tools: {shell: true}});
  });

  test("does not activate untrusted project role layers and rejects routing/transport escapes", () => {
    const ignored = compileCodexModelPolicy({model: "opus", switcherProvider: "switcher", switcherBaseUrl: "http://switcher", trustedProject: false, agents: {project: {trusted: false, config: {model: "foreign"}}}});
    expect(ignored.agents).toHaveLength(0);
    expect(ignored.ignoredUntrustedAgents).toEqual(["project"]);
    expect(() => compileCodexModelPolicy({model: "opus", switcherProvider: "switcher", switcherBaseUrl: "http://switcher", agents: {bad: {trusted: true, config: {model_providers: {foreign: {base_url: "https://foreign"}}}}}})).toThrow(/model_providers/);
    expect(() => compileCodexModelPolicy({model: "opus", switcherProvider: "switcher", switcherBaseUrl: "http://switcher", agents: {bad: {trusted: true, config: {mcp_servers: {x: {transport: "stdio"}}}}}})).toThrow(/mcp_servers/);
  });

  test("extracts only named roles from effective Codex config and requires resolved paths", () => {
    expect(codexAgentsFromEffectiveConfig({agents: {default_subagent_model: "native", reviewer: {description: "Review", config_file: "/state/reviewer.toml"}}})).toEqual({reviewer: {trusted: true, description: "Review", config_file: "/state/reviewer.toml"}});
    expect(() => codexAgentsFromEffectiveConfig({agents: {reviewer: {config_file: "./reviewer.toml"}}})).toThrow(/absolute/);
  });

  test("writes deterministic launch role config with selected provider", async () => {
    const root = await mkdtemp(join(homedir(), "Workspace/scratch/switcher-tests/codex-policy-"));
    try {
      const result = compileCodexModelPolicy({model: "opus", policy: {roles: {subagent: "fast"}}, switcherProvider: "switcher", switcherBaseUrl: "http://switcher", agents: {research: {trusted: true, config: {instructions: ["one", "two"], permission: {shell: "ask"}}}}});
      const paths = await writeCodexAgentOverrides(result, root);
      expect(paths.research).toMatch(/agent-[a-f0-9]{16}\.toml$/);
      const text = await readFile(paths.research!, "utf8");
      expect(text).toContain('model = "fast"');
      expect(text).toContain('model_provider = "switcher"');
      expect(text).toContain('instructions = ["one", "two"]');
      expect(renderCodexAgentToml({"permission.rules": {"shell /tmp": "ask"}, tools: [{name: "shell", enabled: true}]})).toContain('"permission.rules" = { "shell /tmp" = "ask" }');
    } finally { await rm(root, {recursive: true, force: true}); }
  });

  test("loader requires explicit Codex trust and resolves role files relative to the defining project config", async () => {
    const root = await mkdtemp(join(homedir(), "Workspace/scratch/switcher-tests/codex-loader-"));
    const codexHome = join(root, "codex"), project = join(root, "project"), state = join(root, "state");
    try {
      await mkdir(join(project, ".codex"), {recursive: true}); await execFileSync("git", ["init", "-q", project]);
      await mkdir(codexHome, {recursive: true});
      await writeFile(join(codexHome, "config.toml"), `[projects."${project}" ]\ntrust_level = "trusted"\n`);
      await writeFile(join(project, ".codex", "config.toml"), `[agents.research]\nconfig_file = "research.toml"\n`);
      await writeFile(join(project, ".codex", "research.toml"), `instructions = ["keep"]\n[permissions]\nread = "allow"\n`);
      const trusted = await prepareCodexModelPolicy({cwd: project, stateDir: state, home: codexHome, model: "opus", switcherProvider: "switcher", switcherBaseUrl: "http://switcher"});
      expect(trusted.agents.map((agent) => agent.name)).toEqual(["research"]);
      expect(trusted.agents[0]?.config.permissions).toEqual({read: "allow"});
      await writeFile(join(codexHome, "config.toml"), "");
      const untrusted = await prepareCodexModelPolicy({cwd: project, stateDir: join(root, "state2"), home: codexHome, model: "opus", switcherProvider: "switcher", switcherBaseUrl: "http://switcher"});
      expect(untrusted.agents).toHaveLength(0);
    } finally { await rm(root, {recursive: true, force: true}); }
  });
});


test("Codex preserves inherited role files, per-directory distrust, and non-Git trust",async()=>{
 const root=await mkdtemp(join(homedir(),"Workspace/scratch/switcher-tests/codex-trust-"));
 const home=join(root,"home"),project=join(root,"project"),nested=join(project,"nested");
 try{
  await mkdir(home,{recursive:true});await mkdir(join(project,".codex"),{recursive:true});await mkdir(join(nested,".codex"),{recursive:true});
  await writeFile(join(home,"research.toml"),'model="foreign"\ndeveloper_instructions="GLOBAL_ROLE"\n');
  await writeFile(join(home,"config.toml"),`[agents]\nenabled=true\nmax_concurrent_threads_per_session=2\n[agents.research]\nconfig_file="research.toml"\n[projects.${JSON.stringify(project)}]\ntrust_level="trusted"\n`);
  await writeFile(join(project,".codex/config.toml"),'[agents.research]\ndescription="Updated only"\n');
  const input={cwd:project,stateDir:join(root,"state"),home,model:"main",switcherProvider:"switcher",switcherBaseUrl:"http://localhost"};
  const result=await prepareCodexModelPolicy(input);
  expect(result.agents[0].config.developer_instructions).toBe("GLOBAL_ROLE");expect(result.agents[0].model).toBe("main");
  execFileSync("git",["init","-q",project]);
  await writeFile(join(home,"config.toml"),`[projects.${JSON.stringify(project)}]\ntrust_level="trusted"\n[projects.${JSON.stringify(nested)}]\ntrust_level="untrusted"\n`);
  await writeFile(join(nested,".codex/config.toml"),'[agents.bad]\nconfig_file="missing.toml"\n');
  const denied=await prepareCodexModelPolicy({...input,cwd:nested,stateDir:join(root,"state2")});expect(denied.agents.some(a=>a.name==="bad")).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
