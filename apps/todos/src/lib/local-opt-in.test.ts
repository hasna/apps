/**
 * The seam where "blank means unset" meets a resolver that gates its ambient
 * tiers on OBJECT IDENTITY.
 *
 * `todosResolverEnv` removes declared-but-blank authority variables, which
 * means it can only hand @hasna/contracts a COPY of the environment. The
 * resolver reads `env === process.env` (or the registry symbol its own snapshot
 * carries) to decide whether the macOS Keychain — a store that belongs to the
 * MACHINE, not to any env object — is in scope. A copy fails that test, so
 * before `todosResolverInputs` existed, one declared-but-blank variable turned
 * tier 3 off for the whole run, silently: no error, no warning, no diagnostic.
 *
 * On a station whose Keychain holds `hasna.credentials.todos.api-key` that
 * dropped the run to the NEXT identity in the chain — the credential file, a
 * different principal — or, with nothing on disk, to a bare
 * REMOTE_API_CONFIG_MISSING on a station that was in fact configured. The
 * blank shape is not exotic: this repo's own fixtures write it, and any wrapper
 * spelling `HASNA_TODOS_API_URL="${MAYBE_UNSET}"` produces it.
 *
 * These tests are hermetic — no `security` is spawned and the login keychain is
 * never opened. They assert on the GATE the resolver is handed, which is the
 * thing that was being lost, and they name no credential values.
 */
import { describe, expect, test } from "bun:test";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import { resolveTodosCliTransport } from "../cli/cloud-router.js";
import {
  hasTodosEnvAuthorityIntent,
  todosAuthorityEnvKeys,
  todosResolverEnv,
  todosResolverInputs,
} from "./local-opt-in.js";

/** The marker @hasna/contracts stamps on an environment its ambient tiers may use. */
const CONTRACTS_AMBIENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

describe("todosResolverInputs — the Keychain gate survives blank-normalisation", () => {
  test("no blank variable: the env passes through by identity and options are untouched", () => {
    const env = { HASNA_TODOS_API_KEY: "fixture-env-key" };
    const credentials = { profile: "fixture" };
    const inputs = todosResolverInputs(env, credentials);

    // Identity preserved means the resolver runs its OWN ambient test, exactly
    // as it did before this helper existed.
    expect(inputs.env).toBe(env);
    expect(inputs.credentials).toBe(credentials);
  });

  test("a blank variable on the AMBIENT env keeps the Keychain tier enabled", () => {
    const restore = { ...process.env };
    try {
      process.env.TODOS_API_URL = "";
      const inputs = todosResolverInputs(process.env as Record<string, string | undefined>);

      // A copy had to be made — the blank is gone …
      expect(inputs.env).not.toBe(process.env);
      expect("TODOS_API_URL" in inputs.env).toBe(false);
      // … and the gate the copy can no longer prove travels with it.
      expect(inputs.credentials.keychain?.enabled).toBe(true);
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, restore);
    }
  });

  test("a blank variable on a CALLER-BUILT env leaves the Keychain out of scope", () => {
    // The hermetic seam `@hasna/todos/testing` promises: a caller-built world is
    // the whole world, and the machine's Keychain is outside it.
    const inputs = todosResolverInputs({ TODOS_API_URL: "", HASNA_TODOS_API_KEY: "fixture-env-key" });

    expect(inputs.credentials.keychain?.enabled).toBe(false);
  });

  test("a caller-built env carrying the contracts ambient marker stays ambient", () => {
    const env: Record<string, string | undefined> = { TODOS_API_URL: "" };
    Object.defineProperty(env, CONTRACTS_AMBIENT, { value: true, enumerable: false });

    expect(todosResolverInputs(env).credentials.keychain?.enabled).toBe(true);
  });

  test("an injected `security` runner is left to mean what @hasna/contracts says it means", () => {
    const run = (): KeychainCommandResult => ({ status: 44, stdout: "", stderr: "" });
    const inputs = todosResolverInputs({ TODOS_API_URL: "" }, { keychain: { platform: "darwin", run } });

    // Injecting a runner already implies "enabled" in the resolver, so forcing
    // `false` here would switch the tier OFF for every hermetic test that fakes it.
    expect(inputs.credentials.keychain?.enabled).toBeUndefined();
    expect(inputs.credentials.keychain?.run).toBe(run);
  });

  test("an explicit `enabled` from the caller always wins", () => {
    for (const enabled of [true, false]) {
      const inputs = todosResolverInputs({ TODOS_API_URL: "" }, { keychain: { enabled } });
      expect(inputs.credentials.keychain?.enabled).toBe(enabled);
    }
  });

  test("every authority variable is normalised, not just the canonical one", () => {
    for (const key of todosAuthorityEnvKeys()) {
      const inputs = todosResolverInputs({ [key]: "   " });
      expect(key in inputs.env).toBe(false);
      expect(inputs.credentials.keychain?.enabled).toBe(false);
    }
  });

  test("blank still means unset, and a present value is still policed", () => {
    expect(hasTodosEnvAuthorityIntent({ HASNA_TODOS_API_URL: "" })).toBe(false);
    expect(hasTodosEnvAuthorityIntent({ HASNA_TODOS_API_URL: "https://api.hasna.com/todos" })).toBe(true);
    const kept = { HASNA_TODOS_API_KEY: "fixture-env-key" };
    expect(todosResolverEnv(kept)).toBe(kept);
  });
});

describe("the CLI forwards the gate it was given", () => {
  test("`keychain.enabled: false` keeps the tier shut even with a runner injected", () => {
    const calls: string[][] = [];
    const run = (argv: readonly string[]): KeychainCommandResult => {
      calls.push([...argv]);
      return { status: 0, stdout: "fixture-keychain-key\n", stderr: "" };
    };

    // A blank variable forces the copy; the caller's explicit `false` must
    // still reach the resolver rather than being replaced by our own gate.
    expect(() =>
      resolveTodosCliTransport(
        { HOME: "/nonexistent-todos-home", TODOS_API_URL: "" },
        { credentials: { keychain: { platform: "darwin", enabled: false, run } } },
      ),
    ).toThrow(/REMOTE_API_CONFIG_MISSING/);
    expect(calls).toEqual([]);
  });

  test("a blank variable no longer hides an injected Keychain item", () => {
    const run = (argv: readonly string[]): KeychainCommandResult => {
      const service = argv[argv.indexOf("-s") + 1] ?? "";
      if (service === "hasna.credentials.todos.api-key") {
        return { status: 0, stdout: "fixture-keychain-key\n", stderr: "" };
      }
      return { status: 44, stdout: "", stderr: "" };
    };
    const options = { credentials: { keychain: { platform: "darwin", run } } } as const;

    const clean = resolveTodosCliTransport({ HOME: "/nonexistent-todos-home" }, options);
    const blanked = resolveTodosCliTransport({ HOME: "/nonexistent-todos-home", TODOS_API_URL: "" }, options);

    // Same machine state, same tier, same principal — the blank changes nothing.
    expect(blanked.transport).toBe(clean.transport);
    expect(blanked.authority?.apiKeyTier).toBe("keychain");
    expect(blanked.authority?.apiKeySource).toBe(clean.authority?.apiKeySource);
  });
});
