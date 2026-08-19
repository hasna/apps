import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  assertTelegramTokensConfigured,
  missingTelegramTokenEnvVars,
  type BridgeConfig,
} from "../src/index.js";

/**
 * Test-gap coverage for the token-preflight contract in src/lib/serve.ts
 * (missingTelegramTokenEnvVars :40, assertTelegramTokensConfigured :48).
 * The existing suite exercises the failure through `serve()`; these tests lock
 * the error MESSAGE itself, which is what an operator debugging a bot that
 * never connects actually reads. The env probe is process-wide, so every test
 * restores the exact prior env state.
 */

const config: BridgeConfig = {
  version: 1,
  channels: {
    alpha: { id: "alpha", kind: "telegram", enabled: true, botTokenEnv: "GAP_ALPHA_TOKEN", allowedChatIds: ["1"] },
    beta: { id: "beta", kind: "telegram", enabled: true, botTokenEnv: "GAP_BETA_TOKEN", allowedChatIds: ["2"] },
    off: { id: "off", kind: "telegram", enabled: false, botTokenEnv: "GAP_OFF_TOKEN", allowedChatIds: ["3"] },
  },
  profiles: {},
  agents: {},
  routes: [],
};

const ENV_NAMES = ["GAP_ALPHA_TOKEN", "GAP_BETA_TOKEN", "GAP_OFF_TOKEN"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ENV_NAMES) delete process.env[name];
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

test("missingTelegramTokenEnvVars reports every enabled channel's env var, in config order", () => {
  expect(missingTelegramTokenEnvVars(config)).toEqual([
    { channelId: "alpha", envVar: "GAP_ALPHA_TOKEN" },
    { channelId: "beta", envVar: "GAP_BETA_TOKEN" },
  ]);
});

test("a disabled channel's missing token is never reported", () => {
  expect(missingTelegramTokenEnvVars(config).map((item) => item.channelId)).not.toContain("off");
});

test("a channel without botTokenEnv defaults to TELEGRAM_BOT_TOKEN", () => {
  const plain: BridgeConfig = {
    ...config,
    channels: { plain: { id: "plain", kind: "telegram", enabled: true, allowedChatIds: ["1"] } },
  };
  expect(missingTelegramTokenEnvVars(plain)).toEqual([{ channelId: "plain", envVar: "TELEGRAM_BOT_TOKEN" }]);
});

test("a set token removes the channel from the missing list", () => {
  process.env["GAP_ALPHA_TOKEN"] = "123:abc";
  expect(missingTelegramTokenEnvVars(config)).toEqual([
    { channelId: "beta", envVar: "GAP_BETA_TOKEN" },
  ]);
});

test("assertTelegramTokensConfigured names every missing channel and its env var", () => {
  expect(() => assertTelegramTokensConfigured(config)).toThrow(
    /Missing Telegram bot tokens for 2 enabled channels:\n  alpha: set GAP_ALPHA_TOKEN\n  beta: set GAP_BETA_TOKEN/,
  );
});

test("assertTelegramTokensConfigured uses singular wording for one missing channel", () => {
  process.env["GAP_ALPHA_TOKEN"] = "123:abc";
  expect(() => assertTelegramTokensConfigured(config)).toThrow(
    /Missing Telegram bot token for 1 enabled channel:\n  beta: set GAP_BETA_TOKEN/,
  );
});

test("assertTelegramTokensConfigured passes when every enabled channel has a token", () => {
  process.env["GAP_ALPHA_TOKEN"] = "123:abc";
  process.env["GAP_BETA_TOKEN"] = "456:def";
  expect(() => assertTelegramTokensConfigured(config)).not.toThrow();
});
