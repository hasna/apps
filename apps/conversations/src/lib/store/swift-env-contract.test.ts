// The macOS shell's env-key list must not drift from this resolver's.
//
// It already did once, and silently: the shell read 3 env vars while
// `assertUnambiguousStoreEnv` honours 8, five of which select the on-box SQLite
// store. The shell logged `store=hosted` and the child served local data.
//
// Swift cannot import TypeScript, so the contract is GENERATED into
// Sources/HasnaConversationsCore/StoreEnvContract.swift and this test asserts the
// checked-in file is what the generator renders TODAY. It runs in the existing
// ubuntu-latest CI job, so a key added here without regenerating fails CI on
// Linux — no macOS runner needed for the drift check itself.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderSwiftStoreEnvContract, SWIFT_CONTRACT_PATH } from "./swift-env-contract.js";
import { DB_PATH_KEYS, ENV_KEYS } from "./index.js";

const repoRoot = join(import.meta.dir, "..", "..", "..");

describe("swift store-env contract", () => {
  test("the checked-in Swift file matches the TypeScript contract", () => {
    const onDisk = readFileSync(join(repoRoot, SWIFT_CONTRACT_PATH), "utf8");
    expect(onDisk).toBe(renderSwiftStoreEnvContract());
  });

  test("every key this resolver honours appears in the rendered Swift", () => {
    // The check above compares the file to the generator; this one checks the
    // GENERATOR against the resolver, so neither can be quietly narrowed. Without
    // it, dropping a key from the generator would keep both sides agreeing on a
    // contract that no longer covers what the resolver reads.
    const rendered = renderSwiftStoreEnvContract();
    const honoured = [
      ...ENV_KEYS.modeKeys,
      ...ENV_KEYS.apiUrlKeys,
      ...ENV_KEYS.apiKeyKeys,
      ...DB_PATH_KEYS,
    ];
    expect(honoured.length).toBe(10);
    for (const key of honoured) {
      expect(rendered).toContain(`"${key}"`);
    }
  });

  test("the drift check can fail", () => {
    // Positive control. A comparison that passes because both sides are empty,
    // or because the file was read as "", proves nothing about drift.
    const onDisk = readFileSync(join(repoRoot, SWIFT_CONTRACT_PATH), "utf8");
    expect(onDisk.length).toBeGreaterThan(500);
    expect(onDisk).not.toBe(renderSwiftStoreEnvContract().replace("modeKeys", "modeKeysX"));
  });
});
