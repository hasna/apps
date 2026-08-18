import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../test-preload.js";
import { resolveServerConfig } from "./config.js";

useDefaultTestTimeout();

/**
 * Server config resolution — focused on the bundle signing key env contract.
 *
 * Decision record (todos ee1904ca, plan 8022d27f, BUG f068febe): the production
 * deploy (infra-live hasna-app module, infra/apps/skills/prod/main.tf) mounts the
 * signing key under HASNA_SKILLS_API_SIGNING_KEY. The server's canonical name is
 * therefore HASNA_SKILLS_API_SIGNING_KEY — the name the operator actually mounts —
 * with HASNA_SKILLS_SIGNING_KEY retained as a backwards-compatible alias for any
 * deployment or test that predates the rename. Canonical wins when both are set.
 * The key value is never logged or printed anywhere in this package.
 */

const API_NAME = "HASNA_SKILLS_API_SIGNING_KEY";
const LEGACY_NAME = "HASNA_SKILLS_SIGNING_KEY";

describe("resolveServerConfig bundle signing key", () => {
  test("reads the canonical HASNA_SKILLS_API_SIGNING_KEY", () => {
    const config = resolveServerConfig({ [API_NAME]: "test-key-canonical" });
    expect(config.bundleSigningKey).toBe("test-key-canonical");
  });

  test("falls back to the legacy HASNA_SKILLS_SIGNING_KEY when the canonical name is unset", () => {
    const config = resolveServerConfig({ [LEGACY_NAME]: "test-key-legacy" });
    expect(config.bundleSigningKey).toBe("test-key-legacy");
  });

  test("canonical name wins when both are set", () => {
    const config = resolveServerConfig({ [API_NAME]: "test-key-canonical", [LEGACY_NAME]: "test-key-legacy" });
    expect(config.bundleSigningKey).toBe("test-key-canonical");
  });

  test("is undefined when neither name is set", () => {
    const config = resolveServerConfig({});
    expect(config.bundleSigningKey).toBeUndefined();
  });

  test("empty-string value is treated as unset", () => {
    const config = resolveServerConfig({ [API_NAME]: "" });
    expect(config.bundleSigningKey).toBeUndefined();
  });
});
