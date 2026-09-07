import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { explicitCredential, type KeychainCommandRunner, type ResolvedCredential } from "@hasna/contracts/client";
import { resolveMcpStartupGate } from "./startup-gate.js";

/**
 * The contacts-mcp startup gate, in process, on a CALLER-BUILT env: the
 * hermetic seam of the @hasna/contracts chain (the Keychain tier is off unless
 * a runner is injected, the disk tier is rooted at an empty HASNA_HOME), so
 * nothing on the machine decides these tests (hasna/apps#1720 validation,
 * round 2).
 */

const tempHomes: string[] = [];

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "contacts-mcp-gate-"));
  tempHomes.push(home);
  return home;
}

function env(home: string, extra: Record<string, string> = {}): Record<string, string | undefined> {
  return { HASNA_HOME: home, ...extra };
}

function writeCredentialsFile(home: string, name: string, mode: number): string {
  const dir = join(home, "contacts", "config");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, "HASNA_CONTACTS_API_KEY=disk-key-not-a-real-secret\n");
  chmodSync(path, mode);
  return path;
}

afterEach(() => {
  for (const home of tempHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("contacts-mcp startup gate", () => {
  test("refuses with nothing configured and names the tiers on the FIRST line, never a value", async () => {
    const home = freshHome();
    const gate = await resolveMcpStartupGate(env(home));
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    const [firstLine] = gate.message.split("\n");
    expect(firstLine).toContain("contacts-mcp");
    // The same code the CLI and the store raise for this state.
    expect(firstLine).toContain("CONTACTS_API_NOT_CONFIGURED");
    expect(firstLine).toContain("Keychain");
    expect(firstLine).toContain(join(home, "contacts", "config", "credentials"));
    expect(firstLine).toContain("HASNA_CONTACTS_API_KEY");
    expect(gate.message).not.toContain("local-fallback");
  });

  test("passes with an env URL and key, reporting sources only", async () => {
    const gate = await resolveMcpStartupGate(
      env(freshHome(), {
        HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
        HASNA_CONTACTS_API_KEY: "test-key-not-a-real-secret",
      }),
    );
    expect(gate).toEqual({ ok: true, apiUrlSource: "HASNA_CONTACTS_API_URL", apiKeySource: "HASNA_CONTACTS_API_KEY" });
    expect(JSON.stringify(gate)).not.toContain("test-key-not-a-real-secret");
  });

  test("passes through the disk tier under HASNA_HOME, naming the file by path", async () => {
    const home = freshHome();
    writeCredentialsFile(home, "credentials", 0o600);
    const gate = await resolveMcpStartupGate(env(home));
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.apiUrlSource).toBe("default");
    expect(gate.apiKeySource).toContain(join("contacts", "config", "credentials"));
    expect(JSON.stringify(gate)).not.toContain("disk-key-not-a-real-secret");
  });

  test("passes through the Keychain tier via an injected security runner, naming the item", async () => {
    const run: KeychainCommandRunner = (argv) => {
      const service = argv.find((arg) => arg.startsWith("hasna.credentials.contacts."));
      if (service?.endsWith("api-key")) return { status: 0, stdout: "keychain-key-not-a-real-secret\n", stderr: "" };
      return { status: 44, stdout: "", stderr: "" };
    };
    const gate = await resolveMcpStartupGate(env(freshHome(), { HASNA_STATION: "test-station" }), {
      keychain: { enabled: true, platform: "darwin", run },
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.apiKeySource).toBe("keychain:hasna.credentials.contacts.api-key@test-station");
    expect(gate.apiUrlSource).toBe("default");
    expect(JSON.stringify(gate)).not.toContain("keychain-key-not-a-real-secret");
  });

  test("a Keychain item that exists but cannot be read is a refusal, never resolved around", async () => {
    // The api-url item is absent (44); the api-key item exists but is locked (36).
    const run: KeychainCommandRunner = (argv) => {
      const service = argv.find((arg) => arg.startsWith("hasna.credentials.contacts."));
      if (service?.endsWith("api-key")) return { status: 36, stdout: "", stderr: "User interaction is not allowed." };
      return { status: 44, stdout: "", stderr: "" };
    };
    const gate = await resolveMcpStartupGate(env(freshHome(), { HASNA_STATION: "test-station" }), {
      keychain: { enabled: true, platform: "darwin", run },
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.message.split("\n")[0]).toContain("keychain:hasna.credentials.contacts.api-key@test-station");
  });

  test("refuses a URL without a credential and a plaintext authority", async () => {
    const urlOnly = await resolveMcpStartupGate(env(freshHome(), { HASNA_CONTACTS_API_URL: "https://contacts.example.invalid" }));
    expect(urlOnly.ok).toBe(false);
    if (!urlOnly.ok) expect(urlOnly.message.split("\n")[0]).toContain("HASNA_CONTACTS_API_KEY");

    const plaintext = await resolveMcpStartupGate(
      env(freshHome(), { HASNA_CONTACTS_API_URL: "http://127.0.0.1:54321", HASNA_CONTACTS_API_KEY: "test-key" }),
    );
    expect(plaintext.ok).toBe(false);
    if (!plaintext.ok) expect(plaintext.message).toContain("CONTACTS_API_HTTPS_REQUIRED");
  });

  test("refuses retired client storage selectors", async () => {
    const gate = await resolveMcpStartupGate(
      env(freshHome(), {
        HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
        HASNA_CONTACTS_API_KEY: "test-key",
        CONTACTS_DATABASE_URL: "postgresql://should-not-be-in-a-client",
      }),
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message.split("\n")[0]).toContain("RETIRED_CONTACTS_CLIENT_SELECTOR");
  });

  describe("deliberate tiers that cannot be honoured are refusals at the gate", () => {
    test("FAILING INPUT: a well-shaped vault pointer that cannot be dereferenced is refused, naming HASNA_CONTACTS_API_KEY_REF on the first line", async () => {
      // The chain validates the pointer's SHAPE only, so the transport reports
      // `configured`; the gate must dereference it and refuse when the vault
      // cannot complete it (here: no secrets client configurable from a bare
      // env). Previously this started the server and answered `initialize`.
      const gate = await resolveMcpStartupGate(env(freshHome(), { HASNA_CONTACTS_API_KEY_REF: "no/such/vault/item" }));
      expect(gate.ok).toBe(false);
      if (gate.ok) return;
      const [firstLine] = gate.message.split("\n");
      expect(firstLine).toContain("contacts-mcp");
      expect(firstLine).toContain("HASNA_CONTACTS_API_KEY_REF");
      expect(firstLine).toContain("TERMINAL");
      expect(gate.message).not.toContain("local-fallback");
    });

    test("a vault pointer the vault CAN complete passes, naming the pointer and item — never the value", async () => {
      const gate = await resolveMcpStartupGate(
        env(freshHome(), { HASNA_CONTACTS_API_KEY_REF: "hasna/contacts/live/api_key" }),
        {},
        {
          completePointer: async (name, pointer) => {
            expect(name).toBe("contacts");
            expect(pointer.tier).toBe("pointer");
            expect(pointer.source).toBe("HASNA_CONTACTS_API_KEY_REF");
            return {
              ...explicitCredential("contacts", "vault-key-not-a-real-secret"),
              tier: "pointer",
              source: "HASNA_CONTACTS_API_KEY_REF -> vault:hasna/contacts/live/api_key",
              deliberate: true,
            } as ResolvedCredential;
          },
        },
      );
      expect(gate).toEqual({
        ok: true,
        apiUrlSource: "default",
        apiKeySource: "HASNA_CONTACTS_API_KEY_REF -> vault:hasna/contacts/live/api_key",
      });
      expect(JSON.stringify(gate)).not.toContain("vault-key-not-a-real-secret");
    });

    test("a pointer that carries a literal instead of a vault item key is refused", async () => {
      const gate = await resolveMcpStartupGate(env(freshHome(), { HASNA_CONTACTS_API_KEY_REF: "sk-literal-not-a-real-secret" }));
      expect(gate.ok).toBe(false);
      if (gate.ok) return;
      expect(gate.message.split("\n")[0]).toContain("HASNA_CONTACTS_API_KEY_REF");
      expect(gate.message).not.toContain("sk-literal-not-a-real-secret");
    });

    test("HASNA_PROFILE naming a profile with no credentials file is refused, naming the file it looked for", async () => {
      const home = freshHome();
      const gate = await resolveMcpStartupGate(env(home, { HASNA_PROFILE: "no-such-profile" }));
      expect(gate.ok).toBe(false);
      if (gate.ok) return;
      expect(gate.message.split("\n")[0]).toContain(join(home, "contacts", "config", "credentials-no-such-profile"));
    });

    test("an unsafe (group-readable) credentials file is a one-line refusal naming the file, never resolved around", async () => {
      const home = freshHome();
      const path = writeCredentialsFile(home, "credentials", 0o644);
      const gate = await resolveMcpStartupGate(env(home));
      expect(gate.ok).toBe(false);
      if (gate.ok) return;
      const [firstLine] = gate.message.split("\n");
      expect(firstLine).toContain("Refusing unsafe credential/config file");
      expect(firstLine).toContain(path);
      expect(gate.message).not.toContain("disk-key-not-a-real-secret");
    });
  });
});
