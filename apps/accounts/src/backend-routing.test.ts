/**
 * Backend routing, Phase 1 (Claude + DeepSeek anthropic-messages):
 *
 * - backend registry semantics: validation, resolution, fail-closed lookups;
 * - the launch plan: env-conflict removal, `[1m]` context rendering, the
 *   STRUCTURAL `secrets exec` vault wrapper (no value materialization);
 * - adapter protocol rejection (openai-chat refused by the Claude adapter);
 * - the OAuth-bypass negative control: a backend-routed `profileEnv` never
 *   runs the native auth healing/blanking path.
 *
 * No real credentials anywhere: every vault key is a locator and every value
 * synthetic.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountsError, type BackendRoute, type Profile } from "./types.js";
import {
  addBackend,
  EXAMPLE_DEEPSEEK_BACKEND,
  listBackends,
  removeBackend,
  resolveBackend,
  resolveBackendModel,
  validateBackendRoute,
} from "./lib/backend-routes.js";
import {
  claudeBackendAdapter,
  claudeModelWireName,
  CLAUDE_BACKEND_AUTH_ENV_VAR,
} from "./lib/backend-adapters/claude.js";
import { profileEnv } from "./lib/env.js";
import {
  launchArgv,
  launchPlanEnv,
  planLaunch,
  renderLaunchPlanCommand,
  type LaunchPlan,
} from "./lib/launch-plan.js";
import { addProfile, updateProfile } from "./lib/profiles.js";
import { getTool } from "./lib/tools.js";

let home: string;
let sharedHome: string;
const dirs: string[] = [];

function tmpDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `accounts-backend-${label}-`));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  home = tmpDir("home");
  sharedHome = tmpDir("shared");
  process.env.ACCOUNTS_HOME = home;
  process.env.ACCOUNTS_STORE_PATH = join(home, "accounts.json");
  process.env.ACCOUNTS_SHARED_HOME_CLAUDE = sharedHome;
  delete process.env.ACCOUNTS_TEST_LIVE_DIR;
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.ACCOUNTS_HOME;
  delete process.env.ACCOUNTS_STORE_PATH;
  delete process.env.ACCOUNTS_SHARED_HOME_CLAUDE;
});

function deepseekRoute(overrides: Partial<BackendRoute> = {}): BackendRoute {
  return {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "anthropic-messages",
    baseUrl: "https://api.deepseek.com/anthropic",
    vaultKey: "deepseek/api_key",
    models: [
      { id: "deepseek-v4-flash", contextWindowTokens: 1_000_000 },
      { id: "deepseek-v4-pro", contextWindowTokens: 128_000, maxOutputTokens: 16_384 },
    ],
    defaults: { model: "deepseek-v4-flash" },
    ...overrides,
  };
}

function makeProfile(name = "backend-profile"): Profile {
  const dir = tmpDir(name);
  mkdirSync(join(dir, "skills"), { recursive: true });
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(join(dir, ".claude.json"), "{}");
  writeFileSync(join(dir, "settings.json"), "{}");
  return addProfile({ name, dir });
}

test("registry round-trip: add, list, resolve, remove", () => {
  const route = addBackend(deepseekRoute());
  expect(listBackends()).toEqual([route]);
  expect(resolveBackend("deepseek")).toEqual(route);
  removeBackend("deepseek");
  expect(listBackends()).toEqual([]);
});

test("registry: resolve of an unknown id fails closed with a hint", () => {
  expect(() => resolveBackend("missing")).toThrow(/no backend route named "missing"/);
});

test("registry: remove is refused while a profile binds the backend", () => {
  addBackend(deepseekRoute());
  addProfile({ name: "bound", dir: tmpDir("bound"), backendRef: "deepseek" });
  expect(() => removeBackend("deepseek")).toThrow(/bound by profile "bound"/);
});

test("registry validation: baseUrl must be https or localhost http", () => {
  expect(() => validateBackendRoute(deepseekRoute({ baseUrl: "http://api.deepseek.com/anthropic" }))).toThrow(
    /baseUrl must be https:\/\/ or http:\/\/localhost/,
  );
  expect(() => validateBackendRoute(deepseekRoute({ baseUrl: "ftp://example.com" }))).toThrow(
    /baseUrl must be https:\/\/ or http:\/\/localhost/,
  );
  expect(validateBackendRoute(deepseekRoute({ baseUrl: "http://localhost:8080/anthropic" }))).toBeTruthy();
});

test("registry validation: vaultKey is a locator, not a credential value", () => {
  // Assembled at runtime so the SOURCE contains no credential-shaped literal;
  // the validator must still reject the value-shaped string.
  const tokenLike = `sk-ant-${"synthetic".repeat(3)}`;
  expect(() => validateBackendRoute(deepseekRoute({ vaultKey: tokenLike }))).toThrow(
    /looks like a credential VALUE/,
  );
  expect(() => validateBackendRoute(deepseekRoute({ vaultKey: "deep seek/key" }))).toThrow(/vault locator/);
});

test("registry validation: default model and aliases must resolve to registered models", () => {
  expect(() => validateBackendRoute(deepseekRoute({ defaults: { model: "ghost-model" } }))).toThrow(
    /default model "ghost-model" is not among its registered models/,
  );
  expect(() =>
    validateBackendRoute(
      deepseekRoute({
        defaults: { model: "deepseek-v4-flash", aliases: { opus: "ghost-opus" } },
      }),
    ),
  ).toThrow(/alias opus references unknown model/);
});

test("semantic context: the [1m] suffix is RENDERED, never stored", () => {
  const route = deepseekRoute();
  expect(route.models[0]!.contextWindowTokens).toBe(1_000_000);
  expect(route.models.some((model) => model.id.includes("[1m]"))).toBe(false);
  const flash = resolveBackendModel(route, "deepseek-v4-flash");
  const pro = resolveBackendModel(route, "deepseek-v4-pro");
  expect(claudeModelWireName(flash)).toBe("deepseek-v4-flash[1m]");
  expect(claudeModelWireName(pro)).toBe("deepseek-v4-pro");
});

test("adapter: renders base URL, model (with suffix), subagent model, auto-compact, aliases", () => {
  const route = deepseekRoute({
    defaults: {
      model: "deepseek-v4-pro",
      aliases: { opus: "deepseek-v4-pro", sonnet: "deepseek-v4-flash", haiku: "deepseek-v4-flash" },
    },
  });
  const adapter = claudeBackendAdapter(route);
  expect(adapter.env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
  expect(adapter.env.ANTHROPIC_MODEL).toBe("deepseek-v4-pro");
  expect(adapter.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("deepseek-v4-pro");
  // Claude Code accepts a plain token count only; the numeric value must be
  // what ships (the literal "true" parses to NaN and is ignored).
  expect(adapter.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("786432");
  expect(adapter.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("deepseek-v4-pro");
  expect(adapter.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("deepseek-v4-flash[1m]");
  expect(adapter.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("deepseek-v4-flash[1m]");
  expect(adapter.authEnvVar).toBe(CLAUDE_BACKEND_AUTH_ENV_VAR);
  expect(adapter.unsetEnv).toEqual(["ANTHROPIC_API_KEY"]);
});

test("adapter: protocol rejection — openai-chat is refused, not silently rendered", () => {
  expect(() => claudeBackendAdapter(deepseekRoute({ protocol: "openai-chat" }))).toThrow(
    /supports only the anthropic-messages protocol/,
  );
});

test("adapter: unknown model id fails closed", () => {
  expect(() => claudeBackendAdapter(deepseekRoute(), "ghost-model")).toThrow(
    /model "ghost-model" is not registered on backend "deepseek"/,
  );
});

test("plan: backend-api plan builds the STRUCTURAL secrets-exec wrapper with no value materialization", async () => {
  addBackend(deepseekRoute());
  const profile = makeProfile();
  const tool = getTool("claude");
  const plan = await planLaunch(profile, tool, ["-p", "hello"], { backend: resolveBackend("deepseek") });

  expect(plan.authMode).toBe("backend-api");
  expect(plan.command).toBe("claude");
  expect(plan.args).toEqual(["-p", "hello"]);
  expect(plan.secretBindings).toEqual([{ vaultKey: "deepseek/api_key", envVar: "ANTHROPIC_AUTH_TOKEN" }]);

  // The wrapper is ONE construction site, shared by spawn and display.
  expect(launchArgv(plan)).toEqual([
    "secrets",
    "exec",
    "deepseek/api_key",
    "--as",
    "ANTHROPIC_AUTH_TOKEN",
    "--",
    "claude",
    "-p",
    "hello",
  ]);

  // NO value materialization: the public env never carries the credential
  // under any name, and no plan field holds anything but the locator.
  expect(plan.publicEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  expect(plan.publicEnv.ANTHROPIC_API_KEY).toBeUndefined();
  expect(JSON.stringify(plan)).not.toContain("sk-ant-");
  expect(JSON.stringify(plan)).not.toContain("synthetic-secret-value");
});

test("plan: native profile without a backend keeps the existing shape and auth mode", async () => {
  const profile = makeProfile();
  const tool = getTool("claude");
  const plan = await planLaunch(profile, tool, []);
  expect(plan.authMode).toBe("native-profile");
  expect(plan.command).toBe("claude");
  expect(plan.secretBindings).toEqual([]);
  expect(launchArgv(plan)).toEqual(["claude"]);
  // The native plan still routes through the profile's config dir.
  expect(plan.publicEnv.CLAUDE_CONFIG_DIR).toBe(profile.dir);
});

test("env conflicts: adapter-declared conflicts are removed from the final env", async () => {
  addBackend(deepseekRoute());
  const profile = makeProfile();
  const tool = getTool("claude");
  const plan = await planLaunch(profile, tool, [], { backend: resolveBackend("deepseek") });

  expect(plan.unsetEnv).toContain("ANTHROPIC_API_KEY");
  const parent: NodeJS.ProcessEnv = {
    ANTHROPIC_API_KEY: `sk-ant-${"ambient-stale-key-that-must-die-123456"}`,
    ANTHROPIC_BASE_URL: "https://ambient.invalid",
    PATH: "/usr/bin",
  };
  const finalEnv = launchPlanEnv(plan, parent);
  expect(finalEnv.ANTHROPIC_API_KEY).toBeUndefined();
  // The adapter's own values win over ambient ones.
  expect(finalEnv.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
  expect(finalEnv.ANTHROPIC_MODEL).toBe("deepseek-v4-flash[1m]");
  expect(finalEnv.CLAUDE_CONFIG_DIR).toBe(profile.dir);
});

test("OAuth-bypass negative control: backend-routed profileEnv skips native auth blanking and healing", async () => {
  addBackend(deepseekRoute());
  const profile = makeProfile();
  const tool = getTool("claude");
  const adapter = claudeBackendAdapter(resolveBackend("deepseek"));

  const backendEnv = await profileEnv(profile, tool, { backendRoute: resolveBackend("deepseek"), adapterEnv: adapter });
  // The native path blanks every CLAUDE_API_AUTH_ENV_KEYS member to ""; the
  // backend path must NOT — the vault binding owns the credential. The base
  // URL carries the ADAPTER's value, never an empty blank.
  expect(backendEnv.ANTHROPIC_API_KEY).toBeUndefined();
  expect(backendEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  expect(backendEnv.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
  // ...and the adapter env IS present (that is the point of the branch).
  expect(backendEnv.ANTHROPIC_MODEL).toBe("deepseek-v4-flash[1m]");
  expect(backendEnv.CLAUDE_CONFIG_DIR).toBe(profile.dir);

  // POSITIVE CONTROL: the native path still blanks (so the backend branch is
  // not vacuously passing because nothing ever blanked).
  const nativeEnv = await profileEnv(profile, tool);
  expect(nativeEnv.ANTHROPIC_API_KEY).toBe("");
  expect(nativeEnv.ANTHROPIC_AUTH_TOKEN).toBe("");
  expect(nativeEnv.ANTHROPIC_BASE_URL).toBe("");
});

test("OAuth-bypass negative control: a backend profile with NO native auth still plans cleanly", async () => {
  // No .credentials.json, no oauth snapshot anywhere: the native path would
  // still (best-effort) try recovery; the plan must not depend on any of it.
  addBackend(deepseekRoute());
  const profile = makeProfile("no-auth");
  const tool = getTool("claude");
  const plan = await planLaunch(profile, tool, [], { backend: resolveBackend("deepseek") });
  expect(plan.authMode).toBe("backend-api");
  expect(plan.publicEnv.ANTHROPIC_MODEL).toBe("deepseek-v4-flash[1m]");
});

test("render: the display shows the vault LOCATOR and never a secret value", async () => {
  addBackend(deepseekRoute());
  const profile = makeProfile();
  const tool = getTool("claude");
  const plan = await planLaunch(profile, tool, ["-p", "hi"], { backend: resolveBackend("deepseek") });
  const rendered = renderLaunchPlanCommand(plan, { PATH: "/usr/bin" });
  expect(rendered).toContain("secrets exec deepseek/api_key --as ANTHROPIC_AUTH_TOKEN -- claude");
  expect(rendered).not.toContain("ANTHROPIC_AUTH_TOKEN=");
  expect(rendered).not.toContain("sk-ant-");
});

test("plan: the resolved backend route (override or binding) is what the plan uses", async () => {
  addBackend(deepseekRoute());
  const profile = makeProfile();
  const tool = getTool("claude");
  const other = addBackend(
    deepseekRoute({ id: "other", name: "Other", vaultKey: "other/api_key", baseUrl: "https://other.example.com" }),
  );
  const plan = await planLaunch(profile, tool, [], { backend: other });
  expect(plan.secretBindings[0]!.vaultKey).toBe("other/api_key");
  expect(plan.publicEnv.ANTHROPIC_BASE_URL).toBe("https://other.example.com");
});

test("plan: supervisor-bound profiles are refused at the supervisor spawn boundary", async () => {
  addBackend(deepseekRoute());
  const profile = makeProfile("supervised");
  // The refusal lives in the supervisor; here we pin the guard's precondition:
  // a bound profile resolves a backend, an unbound one does not.
  const bound = addProfile({ name: "bound2", dir: tmpDir("bound2"), backendRef: "deepseek" });
  expect(resolveBackend(bound.backendRef!)).toBeDefined();
  expect(profile.backendRef).toBeUndefined();
});

test("the packaged deepseek example is public knowledge, generic, and installable", () => {
  expect(EXAMPLE_DEEPSEEK_BACKEND.id).toBe("deepseek");
  expect(EXAMPLE_DEEPSEEK_BACKEND.protocol).toBe("anthropic-messages");
  expect(EXAMPLE_DEEPSEEK_BACKEND.baseUrl).toBe("https://api.deepseek.com/anthropic");
  expect(() => validateBackendRoute(EXAMPLE_DEEPSEEK_BACKEND)).not.toThrow();
  // Round-trips through the store unchanged.
  addBackend(EXAMPLE_DEEPSEEK_BACKEND);
  expect(resolveBackend("deepseek")).toEqual(EXAMPLE_DEEPSEEK_BACKEND);
});

test("storage: a profile record persists its backendRef binding", async () => {
  addBackend(deepseekRoute());
  const profile = addProfile({ name: "persisted", dir: tmpDir("persisted"), backendRef: "deepseek" });
  expect(profile.backendRef).toBe("deepseek");
  const { loadStore } = await import("./storage.js");
  const reloaded = loadStore().profiles.find((p) => p.name === "persisted");
  expect(reloaded?.backendRef).toBe("deepseek");
  const cleared = updateProfile("persisted", { backendRef: null });
  expect(cleared.backendRef).toBeUndefined();
  expect(loadStore().profiles.find((p) => p.name === "persisted")?.backendRef).toBeUndefined();
});

test("binding validation: a typo'd backendRef fails at bind time, not at launch", () => {
  expect(() => addProfile({ name: "typo", dir: tmpDir("typo"), backendRef: "deepseekk" })).toThrow(
    /no backend route named "deepseekk"/,
  );
});

test("plan: a caller-supplied backend must be registered in the local store", async () => {
  const profile = makeProfile();
  const tool = getTool("claude");
  let threw: unknown;
  try {
    await planLaunch(profile, tool, [], { backend: { ...deepseekRoute(), id: "unregistered" } });
  } catch (error) {
    threw = error;
  }
  expect(threw).toBeInstanceOf(AccountsError);
  expect((threw as Error).message).toContain('no backend route named "unregistered"');
});
