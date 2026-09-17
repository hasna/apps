import { expect, test } from "bun:test";
import { chmod, link, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNativeInstructionOverlay, nativeStateEnvironment, projectNativeState, resolveNativeState } from "../src/native-state";
import { launch } from "../src/launcher";
import type { SwitcherClient } from "../src/sdk";

async function fixture(body: (home: string) => Promise<void>) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "switcher-shared-state-")));
  try { await body(home); } finally { await rm(home, { recursive: true, force: true }); }
}

test("nested account overlays resolve to the canonical corpus through compatible markers", () => fixture(async home => {
  const original = join(home, "native"), overlay = join(home, "subscriptions/profiles/codex/account-a");
  const state = await resolveNativeState("codex", { HOME: home, CODEX_HOME: overlay, HASNA_CODEX_STATE_HOME: original });
  expect(state.home).toBe(original);
  expect(nativeStateEnvironment(state)).toEqual({ HASNA_CODEX_STATE_HOME: original, CODEX_SQLITE_HOME: original });
  expect((await resolveNativeState("codex", { HOME: home, CODEX_HOME: overlay, SUBSCRIPTIONS_SHARED_HOME_CODEX: original })).home).toBe(original);
  expect((await resolveNativeState("codex", { HOME: home, CODEX_HOME: overlay })).home).toBe(join(home, ".codex"));
  expect((await resolveNativeState("claude", { HOME: home, CLAUDE_CONFIG_DIR: overlay, HASNA_CLAUDE_STATE_HOME: join(home, "claude") })).home).toBe(join(home, "claude"));
  await expect(resolveNativeState("codex", { HOME: home, HASNA_CODEX_STATE_HOME: overlay })).rejects.toMatchObject({ code: "native_state_overlay" });
  await expect(resolveNativeState("codex", { HOME: home, HASNA_CODEX_STATE_HOME: "relative" })).rejects.toMatchObject({ code: "native_state_path" });
}));

test("Codex SQLite comes from canonical configuration rather than an inherited account database", () => fixture(async home => {
  const canonical = join(home, ".codex"), sqlite = join(home, "sqlite");
  await mkdir(canonical, { mode: 0o700 });
  await writeFile(join(canonical, "config.toml"), `sqlite_home = ${JSON.stringify(sqlite)}\n`, { mode: 0o600 });
  const state = await resolveNativeState("codex", { HOME: home, CODEX_SQLITE_HOME: join(home, "wrong-account") });
  expect(state.sqliteHome).toBe(sqlite);
  expect(await readdir(canonical)).toEqual(["config.toml"]);
  expect(await readdir(sqlite)).toEqual([]);
  await writeFile(join(canonical, "config.toml"), 'sqlite_home = "relative"\n');
  await expect(resolveNativeState("codex", { HOME: home })).rejects.toMatchObject({ code: "native_state_path" });
}));

test("different provider/auth overlays share exact transcript, tool IDs, skills and history bytes", () => fixture(async home => {
  const state = await resolveNativeState("codex", { HOME: home });
  await mkdir(join(state.home, "sessions"), { mode: 0o700 });
  const transcript = '{"type":"function_call","call_id":"retained-call","arguments":"opaque"}\n{"type":"function_call_output","call_id":"retained-call","output":"exact"}\n';
  await writeFile(join(state.home, "sessions/thread.jsonl"), transcript, { mode: 0o600 });
  await writeFile(join(state.home, "auth.json"), "original-auth-fixture", { mode: 0o600 });
  await writeFile(join(state.home, "AGENTS.md"), "fixture instructions", { mode: 0o600 });
  const a = join(home, "provider-a"), b = join(home, "provider-b");
  for (const dir of [a,b]) { await mkdir(dir, { mode: 0o700 }); await writeFile(join(dir, "auth.json"), dir, { mode: 0o600 }); }
  await projectNativeState(state, a); await projectNativeState(state, b);
  expect(await readFile(join(a, "sessions/thread.jsonl"), "utf8")).toBe(transcript);
  expect(await readFile(join(b, "sessions/thread.jsonl"), "utf8")).toBe(transcript);
  await writeFile(join(a, "history.jsonl"), "new shared history\n");
  expect(await readFile(join(b, "history.jsonl"), "utf8")).toBe("new shared history\n");
  expect(await realpath(join(a, "skills"))).toBe(join(state.home, "skills"));
  expect(await realpath(join(a, "thread-writer-locks"))).toBe(await realpath(join(b, "thread-writer-locks")));
  expect(await realpath(join(a, ".hasna/instructions"))).toBe(join(state.home,".hasna/instructions"));
  expect(await readFile(join(b, "AGENTS.md"), "utf8")).toBe("fixture instructions");
  expect(await readFile(join(state.home, "auth.json"), "utf8")).toBe("original-auth-fixture");
  expect(await readFile(join(a, "auth.json"), "utf8")).toBe(a);
  expect(await readFile(join(b, "auth.json"), "utf8")).toBe(b);
  expect((await readdir(a)).some(name => name.endsWith(".sqlite") || name === "plugins" || name === ".codex-global-state.json")).toBe(false);
  expect(await readdir(a)).not.toContain("session_index.jsonl");
  await projectNativeState(state, a); // Repeated launch is idempotent.
}));

test("existing local state and divergent links refuse projection without deleting or partially linking data", () => fixture(async home => {
  const state = await resolveNativeState("codex", { HOME: home });
  const overlay = join(home, "legacy");await mkdir(overlay, { mode: 0o700 });
  await mkdir(join(overlay, "sessions"), { mode: 0o700 });await writeFile(join(overlay, "sessions/original"), "keep", { mode: 0o600 });
  await expect(projectNativeState(state, overlay)).rejects.toMatchObject({ code: "native_state_migration_required" });
  expect(await readdir(overlay)).toEqual(["sessions"]);expect(await readdir(state.home)).toEqual([]);
  expect(await readFile(join(overlay, "sessions/original"), "utf8")).toBe("keep");
  await rm(join(overlay, "sessions"), { recursive: true });await symlink(home, join(overlay, "sessions"));
  await expect(projectNativeState(state, overlay)).rejects.toMatchObject({ code: "native_state_migration_required" });
  expect(await readdir(state.home)).toEqual([]);
}));

test.each([false, true])("retained SQLite metadata blocks projection before any state links: explicit=%s", explicit => fixture(async home => {
  const state = await resolveNativeState("codex", { HOME: home });
  const overlay = join(home, "old-account"); await mkdir(overlay, { mode: 0o700 });
  const oldDatabase = explicit ? join(home, "old-sqlite") : overlay;
  if (explicit) await mkdir(oldDatabase, { mode: 0o700 });
  const config = explicit ? `sqlite_home = ${JSON.stringify(oldDatabase)}\n` : 'model="retained-model"\n';
  await writeFile(join(overlay, "config.toml"), config, { mode: 0o600 });
  await writeFile(join(overlay, "auth.json"), "private-auth-fixture", { mode: 0o600 });
  await writeFile(join(oldDatabase, "thread_history_1.sqlite-wal"), "unique native metadata", { mode: 0o600 });
  const before = await readdir(overlay);
  await expect(projectNativeState(state, overlay)).rejects.toMatchObject({ code: "native_state_migration_required" });
  expect(await readdir(overlay)).toEqual(before);
  expect(await readdir(state.home)).toEqual([]);
  expect(await readFile(join(overlay, "config.toml"), "utf8")).toBe(config);
  expect(await readFile(join(overlay, "auth.json"), "utf8")).toBe("private-auth-fixture");
  expect(await readFile(join(oldDatabase, "thread_history_1.sqlite-wal"), "utf8")).toBe("unique native metadata");
}));

test("Claude projects and capabilities share state while credentials, settings and plugin caches remain isolated", () => fixture(async home => {
  const state = await resolveNativeState("claude", { HOME: home });
  const overlay = join(home, "gateway");await mkdir(overlay, { mode: 0o700 });
  for (const name of [".credentials.json", "settings.json"]) await writeFile(join(state.home, name), "private fixture", { mode: 0o600 });
  await projectNativeState(state, overlay);
  expect(await realpath(join(overlay, "projects"))).toBe(join(state.home, "projects"));
  expect(await realpath(join(overlay, "skills"))).toBe(join(state.home, "skills"));
  expect(await readdir(overlay)).not.toContain(".credentials.json");expect(await readdir(overlay)).not.toContain("settings.json");expect(await readdir(overlay)).not.toContain("plugins");
}));

test("unsafe canonical state or source symlinks are rejected", () => fixture(async home => {
  const state = await resolveNativeState("codex", { HOME: home });const overlay = join(home, "gateway");await mkdir(overlay, { mode: 0o700 });
  await symlink(home, join(state.home, "skills"));
  await expect(projectNativeState(state, overlay)).rejects.toMatchObject({ code: "native_state_entry" });
  expect(await readdir(overlay)).toEqual([]);
  const alias = join(home, "alias");await symlink(state.home, alias);
  await expect(resolveNativeState("codex", { HOME: home, CODEX_HOME: alias })).rejects.toMatchObject({ code: "native_state_permissions" });
}));

test("optional instructions never create an empty override and become visible through stable links", () => fixture(async home => {
  const state=await resolveNativeState("codex",{HOME:home}),overlay=join(home,"overlay");await mkdir(overlay,{mode:0o700});
  await projectNativeState(state,overlay);
  expect(await Bun.file(join(state.home,"AGENTS.override.md")).exists()).toBe(false);
  expect(await Bun.file(join(overlay,"AGENTS.override.md")).exists()).toBe(false);
  await writeFile(join(state.home,"AGENTS.md"),"shared native instructions",{mode:0o600});
  expect(await readFile(join(overlay,"AGENTS.md"),"utf8")).toBe("shared native instructions");
  await projectNativeState(state,overlay); // Missing override stays a valid dangling projection.
  expect(await Bun.file(join(state.home,"AGENTS.override.md")).exists()).toBe(false);
  await writeFile(join(state.home,"AGENTS.override.md"),"explicit user override",{mode:0o600});
  expect(await readFile(join(overlay,"AGENTS.override.md"),"utf8")).toBe("explicit user override");
}));

test("canonical instruction configuration projects only the audited keys and resolves a trusted relative file", () => fixture(async home => {
  const canonical=join(home,".codex");await mkdir(canonical,{mode:0o700});
  await writeFile(join(canonical,"model.md"),"native model instructions",{mode:0o600});
  await writeFile(join(canonical,"config.toml"),'instructions="system fixture"\ndeveloper_instructions="developer fixture"\nmodel_instructions_file="model.md"\ncompact_prompt="compact fixture"\ninclude_permissions_instructions=false\ninclude_apps_instructions=true\ninclude_collaboration_mode_instructions=false\ninclude_environment_context=true\nproject_doc_max_bytes=65536\nproject_doc_fallback_filenames=["RULES.md"]\nmodel_provider="must-not-copy"\n[model_providers.private]\nbase_url="https://fixture.invalid"\n',{mode:0o600});
  const state=await resolveNativeState("codex",{HOME:home});
  expect(state.instructions).toEqual({instructions:"system fixture",developer_instructions:"developer fixture",model_instructions_file:join(canonical,"model.md"),compact_prompt:"compact fixture",include_permissions_instructions:false,include_apps_instructions:true,include_collaboration_mode_instructions:false,include_environment_context:true,project_doc_max_bytes:65536,project_doc_fallback_filenames:["RULES.md"]});
  await rm(join(canonical,"model.md"));await symlink(join(canonical,"config.toml"),join(canonical,"model.md"));
  await expect(resolveNativeState("codex",{HOME:home})).rejects.toMatchObject({code:"native_state_instructions"});
  await writeFile(join(canonical,"config.toml"),'developer_instructions=7\n');
  await expect(resolveNativeState("codex",{HOME:home})).rejects.toMatchObject({code:"native_state_instructions"});
  await writeFile(join(canonical,"config.toml"),'profile="legacy"\n');
  await expect(resolveNativeState("codex",{HOME:home})).rejects.toMatchObject({code:"native_state_config"});
}));

test("writable ancestry and hardlinked canonical files fail before projection", () => fixture(async home => {
  const parent=join(home,"writable"),canonical=join(parent,"state");await mkdir(parent,{mode:0o700});await mkdir(canonical,{mode:0o700});await chmod(parent,0o777);
  await expect(resolveNativeState("codex",{HOME:home,HASNA_CODEX_STATE_HOME:canonical})).rejects.toMatchObject({code:"native_state_permissions"});
  await chmod(parent,0o700);
  const state=await resolveNativeState("codex",{HOME:home}),overlay=join(home,"overlay");await mkdir(overlay,{mode:0o700});
  await writeFile(join(state.home,"auth.json"),"synthetic private fixture",{mode:0o600});await link(join(state.home,"auth.json"),join(state.home,"history.jsonl"));
  await expect(projectNativeState(state,overlay)).rejects.toMatchObject({code:"native_state_entry"});expect(await readdir(overlay)).toEqual([]);
  await link(join(state.home,"auth.json"),join(state.home,"config.toml"));
  await expect(resolveNativeState("codex",{HOME:home})).rejects.toMatchObject({code:"native_state_config"});
}));

test("nested Codex CLI instructions must match canonical keys without changing private config or auth", () => fixture(async home => {
  const canonical=join(home,".codex"),overlay=join(home,"account");
  for(const directory of [canonical,overlay]) await mkdir(directory,{mode:0o700});
  await writeFile(join(canonical,"model.md"),"shared instructions",{mode:0o600});
  await writeFile(join(canonical,"config.toml"),'developer_instructions="shared developer"\nmodel_instructions_file="model.md"\ninclude_environment_context=false\nproject_doc_fallback_filenames=["RULES.md"]\n',{mode:0o600});
  await writeFile(join(overlay,"auth.json"),"private-auth-fixture",{mode:0o600});
  const state=await resolveNativeState("codex",{HOME:home});
  await expect(assertNativeInstructionOverlay(state,canonical)).resolves.toBeUndefined();
  await expect(assertNativeInstructionOverlay(state,overlay)).rejects.toMatchObject({code:"native_state_instruction_overlay"});
  const config='developer_instructions="shared developer"\nmodel_instructions_file="../.codex/model.md"\ninclude_environment_context=false\nproject_doc_fallback_filenames=["RULES.md"]\nmodel_provider="private-account-routing"\n';
  await writeFile(join(overlay,"config.toml"),config,{mode:0o600});
  await expect(assertNativeInstructionOverlay(state,overlay)).resolves.toBeUndefined();
  expect(await readFile(join(overlay,"config.toml"),"utf8")).toBe(config);
  expect(await readFile(join(overlay,"auth.json"),"utf8")).toBe("private-auth-fixture");
  const stale=config+'compact_prompt="stale private instructions"\n';
  await writeFile(join(overlay,"config.toml"),stale);
  await expect(assertNativeInstructionOverlay(state,overlay)).rejects.toMatchObject({code:"native_state_instruction_overlay"});
  expect(await readFile(join(overlay,"config.toml"),"utf8")).toBe(stale);
  expect(await readdir(overlay)).toEqual(["auth.json","config.toml"]);
  await writeFile(join(overlay,"model.md"),"shared instructions",{mode:0o600});
  await writeFile(join(overlay,"config.toml"),config.replace("../.codex/model.md","model.md"));
  await expect(assertNativeInstructionOverlay(state,overlay)).rejects.toMatchObject({code:"native_state_instruction_overlay"});
}));

test("private instruction overlays cannot retain stale keys when canonical config is empty", () => fixture(async home => {
  const state=await resolveNativeState("codex",{HOME:home}),overlay=join(home,"account");await mkdir(overlay,{mode:0o700});
  await expect(assertNativeInstructionOverlay(state,overlay)).resolves.toBeUndefined();
  await writeFile(join(overlay,"config.toml"),'instructions="old account instructions"\n',{mode:0o600});
  await expect(assertNativeInstructionOverlay(state,overlay)).rejects.toMatchObject({code:"native_state_instruction_overlay"});
  await writeFile(join(overlay,"config.toml"),'profile="legacy"\n');
  await expect(assertNativeInstructionOverlay(state,overlay)).rejects.toMatchObject({code:"native_state_config"});
  for(const config of ['include="hidden.toml"\n','[profiles.legacy]\ndeveloper_instructions="hidden"\n']) {
    await writeFile(join(overlay,"config.toml"),config);
    await expect(assertNativeInstructionOverlay(state,overlay)).rejects.toMatchObject({code:"native_state_instruction_overlay"});
  }
}));

test("CLI launch refuses a stale instruction overlay before linking corpus or starting a native run", () => fixture(async home => {
  const canonical=join(home,".codex"),overlay=join(home,"account"),executable=join(home,"native-fixture"),started=join(home,"started");
  for(const path of [canonical,overlay]) await mkdir(path,{mode:0o700});
  await writeFile(join(canonical,"config.toml"),'developer_instructions="canonical fixture"\n',{mode:0o600});
  const config='developer_instructions="stale fixture"\n';
  await writeFile(join(overlay,"config.toml"),config,{mode:0o600});
  await writeFile(join(overlay,"auth.json"),"private-auth-fixture",{mode:0o600});
  await writeFile(executable,`#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'codex-cli 0.154.0'; exit 0; fi\ntouch '${started}'\nexit 99\n`,{mode:0o700});
  let runs=0;
  const client={getProfile:async()=>({harness:"codex",providerId:"fixture"}),
    launchPlan:async()=>({profile:{harness:"codex",model:"fixture-model"},provider:{baseUrl:"http://127.0.0.1:1",protocol:"openai-responses"},catalog:{models:[{id:"fixture-model",name:"Fixture"}]},warnings:[]}),
    createRun:async()=>{runs++;throw new Error("must not create run");}} as unknown as SwitcherClient;
  const environment={HOME:home,CODEX_HOME:overlay,HASNA_CODEX_STATE_HOME:canonical};
  const previous=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,environment);
    await expect(launch(client,"fixture",{refresh:false,executable,cwd:home,stateDir:join(home,"launch-state"),resolveCredential:async()=>"fixture-only"})).rejects.toMatchObject({code:"native_state_instruction_overlay"});
    expect(runs).toBe(0);expect(await Bun.file(started).exists()).toBe(false);
    expect(await readdir(canonical)).toEqual(["config.toml"]);expect(await readdir(overlay)).toEqual(["auth.json","config.toml"]);
    expect(await readFile(join(overlay,"config.toml"),"utf8")).toBe(config);
    expect(await readFile(join(overlay,"auth.json"),"utf8")).toBe("private-auth-fixture");
  } finally {for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
}));
