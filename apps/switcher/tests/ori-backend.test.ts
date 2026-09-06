import { test, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertSupportedOriVersion, inspectOri, oriNativeFlags, oriProviderCatalog, prepareOriLaunch, requireOriHarness, OriBackendError, type OriLaunchRequest } from "../src/ori-backend";

const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace/scratch/switcher-tests");

async function fixtureDir() {
  await mkdir(scratch, {recursive: true});
  return mkdtemp(join(scratch, "ori-backend-"));
}

async function fixtureOri(dir: string) {
  const executable = join(dir, "ori-fixture");
  await writeFile(executable, `#!/bin/sh
case "$1 $2 $3" in
  "--version  ") printf '%s\\n' '{"ok":true,"command":"version","data":{"name":"@ori-runtime/cli","version":"0.12.1+fixture"}}' ;;
  "harness list --json") printf '%s\\n' '{"ok":true,"command":"harness list","data":{"launchable":[{"kind":"claude","displayName":"Claude Code","installed":true,"path":"/fixture/claude"},{"kind":"codex","displayName":"Codex CLI","installed":true,"path":"/fixture/codex"},{"kind":"grok","installed":false},{"kind":"opencode","installed":false}]}}' ;;
  *)
    printf '%s\\n' "$@" > "$PWD/args"
    if [ -n "$OPENROUTER_API_KEY" ]; then printf '%s\\n' present > "$PWD/key-presence"; else printf '%s\\n' absent > "$PWD/key-presence"; fi
    case " $* " in
      *" --fixture-hang "*) trap 'exit 143' TERM INT; while :; do sleep 1; done ;;
      *" --fixture-exit-7 "*) exit 7 ;;
    esac
    exit 0
    ;;
esac
`, {mode: 0o700});
  return executable;
}

const catalog = {source: "switcher-openrouter" as const, modelIds: ["openrouter/model", "second/model"] as const};
function request(overrides: Partial<OriLaunchRequest> = {}): OriLaunchRequest & {environment: NodeJS.ProcessEnv} {
  return {
    target: "codex", provider: "openrouter", providerBaseUrl: "https://openrouter.ai/api/v1", protocol: "openai-responses",
    model: "openrouter/model", catalog, environment: {PATH: process.env.PATH, HOME: "/fixture/home", OPENROUTER_API_KEY: "fixture-key-never-a-real-key"}, ...overrides,
  };
}

test("Ori provider catalog is OpenRouter-only and declares native flags/catalog ownership", () => {
  expect(oriProviderCatalog).toHaveLength(1);
  expect(oriProviderCatalog[0]).toMatchObject({id: "openrouter", credentialEnv: "OPENROUTER_API_KEY", publicModelsUrl: "https://openrouter.ai/api/v1/models", entitledModelsUrl: "https://openrouter.ai/api/v1/models/user"});
  expect(oriNativeFlags.codex).toEqual(["--model", "--reasoning-effort"]);
  expect(oriNativeFlags.grok).toEqual(["--model", "--reasoning-effort"]);
  expect(() => prepareOriLaunch({...request(), provider: "deepseek"})).toThrowError(OriBackendError);
});

test("prepareOriLaunch validates OpenRouter authority/protocol and the Switcher-owned catalog", () => {
  const plan = prepareOriLaunch({...request(), args: ["exec", "--fixture-prompt"], reasoningEffort: "high", executable: "/fixture/ori"});
  expect(plan.executable).toBe("/fixture/ori");
  expect(plan.args).toEqual(["codex", "--model", "openrouter/model", "--reasoning-effort", "high", "exec", "--fixture-prompt"]);
  expect(plan.env.ORI_FORCE_OPENROUTER_API_KEY).toBe("1");
  expect(plan.env.OPENROUTER_API_KEY).toBe("fixture-key-never-a-real-key");
  expect(plan.args.join(" ")).not.toContain("fixture-key-never-a-real-key");
  for (const invalid of [
    {...request(), providerBaseUrl: "https://evil.example/api/v1"},
    {...request(), providerBaseUrl: "https://openrouter.ai/api/v1", protocol: "openai-chat" as const},
  ]) expect(() => prepareOriLaunch(invalid)).toThrow("provider");
  expect(() => prepareOriLaunch({...request(), catalog: {source: "switcher-openrouter" as const, modelIds: ["other/model"]}})).toThrow("catalog");
  expect(() => prepareOriLaunch({...request(), providerBaseUrl: undefined})).toThrow("provider");
});

test("prepareOriLaunch fails closed on missing key or native Ori login lockdown", () => {
  expect(() => prepareOriLaunch({...request(), environment: {PATH: process.env.PATH, HOME: "/fixture/home"}})).toThrow("key must be supplied");
  expect(() => prepareOriLaunch({...request(), environment: {PATH: process.env.PATH, HOME: "/fixture/home", OPENROUTER_API_KEY: "fixture-key", ORI_REQUIRE_LOGIN: "1"}})).toThrow("cannot bypass native Ori login policy");
});

test("Ori rejects OpenCode 2, Claude global-config mutation, and provider/model overrides", () => {
  expect(() => prepareOriLaunch({...request(), target: "opencode2"})).toThrow("OpenCode 2");
  expect(() => prepareOriLaunch({...request(), target: "claude", protocol: "anthropic-messages"})).toThrow("preservation subset");
  for (const args of [["--model=other/model"], ["-mother/model"], ["--provider", "other"], ["--provider=other"], ["-c", "model_providers.switcher.base_url=https://other.example"], ["-cmodel_provider=other"]])
    expect(() => prepareOriLaunch({...request(), args})).toThrow("reserved");
});

test("inspectOri reads only version and harness inventory from a controlled Ori fixture", async () => {
  const dir = await fixtureDir();
  try {
    const executable = await fixtureOri(dir);
    const contract = await inspectOri({executable, environment: {PATH: process.env.PATH, HOME: dir}, cwd: dir});
    expect(contract.version).toBe("0.12.1+fixture");
    expect(() => assertSupportedOriVersion(contract)).not.toThrow();
    expect(requireOriHarness(contract, "codex")).toMatchObject({installed: true, path: "/fixture/codex"});
    expect(() => requireOriHarness(contract, "grok")).toThrow("not installed");
    expect(() => requireOriHarness(contract, "opencode2")).toThrow("OpenCode 2");
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test("controlled plan subprocess preserves passthrough, key isolation, exit status and cleanup", async () => {
  const dir = await fixtureDir();
  try {
    const executable = await fixtureOri(dir);
    const plan = prepareOriLaunch({...request(), executable, args: ["exec", "--fixture-exit-7"]});
    const exited = Bun.spawn([plan.executable, ...plan.args], {cwd: dir, env: plan.env, stdio: ["ignore", "ignore", "ignore"]});
    expect(await exited.exited).toBe(7);
    expect((await readFile(join(dir, "args"), "utf8")).split("\n").slice(0, 3)).toEqual(["codex", "--model", "openrouter/model"]);
    expect(await readFile(join(dir, "key-presence"), "utf8")).toBe("present\n");

    const hangingPlan = prepareOriLaunch({...request(), executable, args: ["--fixture-hang"], environment: {PATH: process.env.PATH, HOME: dir, OPENROUTER_API_KEY: "fixture-key"}});
    const hanging = Bun.spawn([hangingPlan.executable, ...hangingPlan.args], {cwd: dir, env: hangingPlan.env, stdio: ["ignore", "ignore", "ignore"]});
    await new Promise(resolve => setTimeout(resolve, 50));
    hanging.kill("SIGTERM");
    expect(await hanging.exited).toBe(143);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test.skipIf(!process.env.SWITCHER_TEST_ORI_EXECUTABLE)("installed Ori read-only contract reports its version and native inventory", async () => {
  const installed = process.env.SWITCHER_TEST_ORI_EXECUTABLE!;
  const contract = await inspectOri({executable: installed, environment: {PATH: process.env.PATH, HOME: process.env.HOME}});
  expect(() => assertSupportedOriVersion(contract)).not.toThrow();
  expect(contract.harnesses.map(row => row.kind)).toEqual(expect.arrayContaining(["claude", "codex", "grok", "opencode"]));
  for (const harness of contract.harnesses.filter(row => row.installed)) {
    expect(harness.path).toBeDefined();
    expect(await Bun.file(harness.path!).exists()).toBe(true);
  }
});
