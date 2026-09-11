/**
 * Hermetic unit tests for the `loops-mcp` startup gate (hasna/apps#1720
 * validation, round 3).
 *
 * Every case runs against a caller-built env anchored at a fresh temp home
 * (the disk tier consults nothing real) with an INJECTED `security` runner
 * (the machine's login keychain is never opened) — so the outcomes below hold
 * on a provisioned station and on a bare CI box alike. Assertions are on
 * observable routing (which tiers were consulted, where the key came from)
 * and on the refusal text naming WHERE the credential should live; no
 * credential value ever appears in a message.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeychainCommandResult, ResolvedCredential } from "@hasna/contracts/client";
import { resetLocalLoopsModeNotice } from "../lib/cloud/resolve.js";
import { LOOPS_MCP_REFUSAL_PREFIX, resolveLoopsMcpStartupGate } from "./startup-gate.js";

const KEYCHAIN_ITEM = "hasna.credentials.loops.api-key";
const KEYCHAIN_KEY = "fixture-keychain-key";
const STATION = "no-such-station";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  resetLocalLoopsModeNotice();
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `loops-mcp-gate-${label}-`));
  tempRoots.push(root);
  return root;
}

function fakeKeychain(items: Record<string, string>) {
  const calls: string[][] = [];
  const run = (argv: readonly string[]): KeychainCommandResult => {
    calls.push([...argv]);
    const service = argv[argv.indexOf("-s") + 1] ?? "";
    const value = items[service];
    if (value === undefined) return { status: 44, stdout: "", stderr: "" };
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
  return { calls, credentials: { keychain: { platform: "darwin", run } } };
}

function gateEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  return { HOME: home, HASNA_HOME: home, HASNA_STATION: STATION, ...extra };
}

function firstLine(message: string): string {
  return message.split("\n")[0] ?? "";
}

describe("loops-mcp startup gate refuses with no connection configured", () => {
  test("FAILING INPUT: an empty home, an absent Keychain account and no env key refuse on ONE line naming every tier", async () => {
    const home = tempHome("empty");
    const keychain = fakeKeychain({});

    const gate = await resolveLoopsMcpStartupGate(gateEnv(home), keychain.credentials);

    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    const line = firstLine(gate.message);
    expect(line.startsWith(LOOPS_MCP_REFUSAL_PREFIX)).toBe(true);
    expect(line).toContain("no loops client connection is configured");
    expect(line).toContain("HASNA_LOOPS_API_URL");
    expect(line).toContain("HASNA_LOOPS_API_KEY");
    expect(line).toContain(KEYCHAIN_ITEM);
    expect(line).toContain(join(home, "loops", "config", "credentials"));
    expect(line).toContain("HASNA_LOOPS_CONNECTION=file");
    // The chain actually ran down to the Keychain tier, under the sentinel
    // station account: the gate is the real resolver, not a shortcut.
    expect(keychain.calls.length).toBeGreaterThan(0);
    expect(keychain.calls.every((argv) => argv.includes("-a") && argv[argv.indexOf("-a") + 1] === STATION)).toBe(true);
    expect(keychain.calls.some((argv) => argv.includes(KEYCHAIN_ITEM))).toBe(true);
    // Nothing was created under the app home.
    expect(readdirSync(home)).toEqual([]);
  });

  test("the retired HASNA_LOOPS_CONNECTION=api selector is a refusal, never resolved around", async () => {
    const home = tempHome("api-retired");
    const keychain = fakeKeychain({ [KEYCHAIN_ITEM]: KEYCHAIN_KEY });

    const gate = await resolveLoopsMcpStartupGate(gateEnv(home, { HASNA_LOOPS_CONNECTION: "api" }), keychain.credentials);

    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    expect(firstLine(gate.message)).toContain("HASNA_LOOPS_CONNECTION=api is retired");
    expect(keychain.calls).toEqual([]);
    expect(gate.message).not.toContain(KEYCHAIN_KEY);
  });
});

describe("loops-mcp startup gate refuses a deliberate tier it cannot honour", () => {
  test("HASNA_PROFILE naming a missing profile file refuses on one line naming that file, ignoring the Keychain key", async () => {
    const home = tempHome("profile");
    const keychain = fakeKeychain({ [KEYCHAIN_ITEM]: KEYCHAIN_KEY });

    const gate = await resolveLoopsMcpStartupGate(gateEnv(home, { HASNA_PROFILE: "no-such-profile" }), keychain.credentials);

    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    const line = firstLine(gate.message);
    expect(line.startsWith(LOOPS_MCP_REFUSAL_PREFIX)).toBe(true);
    expect(line).toContain("HASNA_PROFILE");
    expect(line).toContain(join(home, "loops", "config", "credentials-no-such-profile"));
    expect(gate.message).not.toContain(KEYCHAIN_KEY);
    expect(readdirSync(home)).toEqual([]);
  });

  test("an unsafe (0644) credentials file is a one-line refusal naming the file, never the value", async () => {
    const home = tempHome("unsafe");
    const dir = join(home, "loops", "config");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "credentials");
    writeFileSync(path, "HASNA_LOOPS_API_KEY=disk-key-not-a-real-secret\n");
    chmodSync(path, 0o644);
    const keychain = fakeKeychain({});

    const gate = await resolveLoopsMcpStartupGate(gateEnv(home), keychain.credentials);

    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    const line = firstLine(gate.message);
    expect(line.startsWith(LOOPS_MCP_REFUSAL_PREFIX)).toBe(true);
    expect(line).toContain(path);
    expect(gate.message).not.toContain("disk-key-not-a-real-secret");
  });

  test("a vault pointer the process cannot dereference refuses naming HASNA_LOOPS_API_KEY_REF; the chain alone accepted its shape", async () => {
    const home = tempHome("pointer");
    const keychain = fakeKeychain({ [KEYCHAIN_ITEM]: KEYCHAIN_KEY });
    const seen: ResolvedCredential[] = [];
    const completePointer = async (_name: string, pointer: ResolvedCredential): Promise<ResolvedCredential> => {
      seen.push(pointer);
      throw new Error("HASNA_LOOPS_API_KEY_REF names vault item 'no/such/vault/item', but the vault could not be reached. A vault pointer is TERMINAL.");
    };

    const gate = await resolveLoopsMcpStartupGate(
      gateEnv(home, { HASNA_LOOPS_API_KEY_REF: "no/such/vault/item" }),
      keychain.credentials,
      { completePointer },
    );

    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    expect(firstLine(gate.message)).toContain("HASNA_LOOPS_API_KEY_REF");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tier).toBe("pointer");
    expect(seen[0]?.pointerVaultKey).toBe("no/such/vault/item");
    // A deliberate pointer never falls through to the Keychain identity.
    expect(gate.message).not.toContain(KEYCHAIN_KEY);
  });

  test("a vault pointer without an injected completer refuses through the real completer (no vault configured here)", async () => {
    const home = tempHome("pointer-real");
    const keychain = fakeKeychain({});

    const gate = await resolveLoopsMcpStartupGate(
      gateEnv(home, { HASNA_LOOPS_API_KEY_REF: "no/such/vault/item" }),
      keychain.credentials,
    );

    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    expect(firstLine(gate.message)).toContain("HASNA_LOOPS_API_KEY_REF");
    expect(firstLine(gate.message)).toContain("TERMINAL");
  });

  test("a vault pointer the completer CAN dereference passes, reporting the completed source and dropping the key", async () => {
    const home = tempHome("pointer-ok");
    const keychain = fakeKeychain({});
    const completePointer = async (_name: string, pointer: ResolvedCredential): Promise<ResolvedCredential> => ({
      ...pointer,
      apiKey: "vault-key-not-a-real-secret",
      source: `${pointer.source} -> vault item ${pointer.pointerVaultKey}`,
    });

    const gate = await resolveLoopsMcpStartupGate(
      gateEnv(home, { HASNA_LOOPS_API_KEY_REF: "fleet/loops/live/api_key" }),
      keychain.credentials,
      { completePointer },
    );

    expect(gate).toEqual({
      ok: true,
      transport: "api",
      apiKeySource: "HASNA_LOOPS_API_KEY_REF -> vault item fleet/loops/live/api_key",
    });
    expect(JSON.stringify(gate)).not.toContain("vault-key-not-a-real-secret");
  });
});

describe("loops-mcp startup gate passes a configured connection", () => {
  test("the Keychain item under the station account resolves the hosted transport and names the item as the source", async () => {
    const home = tempHome("keychain");
    const keychain = fakeKeychain({ [KEYCHAIN_ITEM]: KEYCHAIN_KEY });

    const gate = await resolveLoopsMcpStartupGate(gateEnv(home), keychain.credentials);

    expect(gate).toEqual({ ok: true, transport: "api", apiKeySource: `keychain:${KEYCHAIN_ITEM}@${STATION}` });
    expect(JSON.stringify(gate)).not.toContain(KEYCHAIN_KEY);
    expect(readdirSync(home)).toEqual([]);
  });

  test("an env credential resolves the hosted transport through the same chain", async () => {
    const home = tempHome("env");
    const keychain = fakeKeychain({});

    const gate = await resolveLoopsMcpStartupGate(
      gateEnv(home, { HASNA_LOOPS_API_URL: "https://loops.example.invalid", HASNA_LOOPS_API_KEY: "test-key-not-a-real-secret" }),
      keychain.credentials,
    );

    expect(gate).toEqual({ ok: true, transport: "api", apiKeySource: "HASNA_LOOPS_API_KEY" });
    expect(JSON.stringify(gate)).not.toContain("test-key-not-a-real-secret");
  });

  test("the 0600 credentials file under HASNA_HOME resolves the hosted transport and names the file", async () => {
    const home = tempHome("disk");
    const dir = join(home, "loops", "config");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "credentials");
    writeFileSync(path, "HASNA_LOOPS_API_KEY=disk-key-not-a-real-secret\n");
    chmodSync(path, 0o600);
    const keychain = fakeKeychain({});

    const gate = await resolveLoopsMcpStartupGate(gateEnv(home), keychain.credentials);

    expect(gate).toEqual({ ok: true, transport: "api", apiKeySource: path });
    expect(JSON.stringify(gate)).not.toContain("disk-key-not-a-real-secret");
    // Only the file the test wrote exists; the gate created nothing.
    expect(readdirSync(dir)).toEqual(["credentials"]);
  });

  test("the explicit HASNA_LOOPS_CONNECTION=file opt-in selects the local store without consulting the Keychain or creating it", async () => {
    const home = tempHome("file");
    const keychain = fakeKeychain({});

    const gate = await resolveLoopsMcpStartupGate(gateEnv(home, { HASNA_LOOPS_CONNECTION: "file" }), keychain.credentials);

    expect(gate).toEqual({ ok: true, transport: "file", apiKeySource: null });
    expect(keychain.calls).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
  });
});
