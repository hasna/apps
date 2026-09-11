import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientResolutionError } from "./errors.js";
import {
  ClientTransportConfigurationError,
  describeClientTransport,
  resolveClientTransport,
  type KeychainCommandRunner,
} from "./transport.js";

const locked: KeychainCommandRunner = () => ({
  status: 36,
  stdout: "",
  stderr: "security: SecKeychainSearchCopyNext: User interaction is not allowed.",
});
const missing: KeychainCommandRunner = () => ({ status: 44, stdout: "", stderr: "could not be found" });
const darwin = (run: KeychainCommandRunner) => ({ credentials: { keychain: { platform: "darwin", hostname: () => "fixture-host", run } } });

describe("resolveClientTransport carries the discriminated codes", () => {
  test("no credential anywhere is CREDENTIAL_ABSENT (exit 2) with the consulted sources named", () => {
    let thrown: unknown;
    try {
      resolveClientTransport("todos", { HOME: "/nonexistent/home" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ClientTransportConfigurationError);
    const error = thrown as ClientTransportConfigurationError;
    expect(error.code).toBe("CREDENTIAL_ABSENT");
    expect(error.exitCode).toBe(2);
    // Byte-stable 1.0.x message.
    expect(error.message).toMatch(/HASNA_TODOS_API_URL is not set and no API key could be resolved for 'todos'/);
    expect(error.sources).toEqual([
      "HASNA_TODOS_API_URL",
      "keychain:hasna.credentials.todos.api-key",
      "/nonexistent/home/.hasna/todos/config/credentials",
      "HASNA_TODOS_API_KEY",
    ]);
    expect(error.remedy).toContain("hasna.credentials.todos.api-key");
    expect(error.remedy).toContain("HASNA_TODOS_LOCAL=1");
  });

  test("blank, malformed and disagreeing authorities are AUTHORITY_INVALID / AUTHORITY_CONFLICT (exit 5)", () => {
    const code = (env: Record<string, string>) => {
      try {
        resolveClientTransport("todos", env);
      } catch (error) {
        return (error as ClientResolutionError).code;
      }
      return null;
    };
    expect(code({ HASNA_TODOS_API_URL: "", HASNA_TODOS_API_KEY: "k" })).toBe("AUTHORITY_INVALID");
    expect(code({ HASNA_TODOS_API_URL: "http://todos.example.test", HASNA_TODOS_API_KEY: "k" })).toBe("AUTHORITY_INVALID");
    expect(code({ HASNA_TODOS_API_URL: "https://a.example.test", TODOS_API_URL: "https://b.example.test", HASNA_TODOS_API_KEY: "k" })).toBe(
      "AUTHORITY_CONFLICT",
    );
  });

  test("a locked Keychain is CREDENTIAL_UNREADABLE (exit 3) and never absent", () => {
    let thrown: unknown;
    try {
      resolveClientTransport("todos", { HASNA_STATION: "s" }, darwin(locked));
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ClientResolutionError).code).toBe("CREDENTIAL_UNREADABLE");
    expect((thrown as ClientResolutionError).exitCode).toBe(3);
  });

  test("an uncomposable default authority is AUTHORITY_MISSING (exit 5)", () => {
    let thrown: unknown;
    try {
      resolveClientTransport("Todos", { HASNA_TODOS_API_KEY: "k" });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ClientResolutionError).code).toBe("AUTHORITY_MISSING");
  });
});

describe("describeClientTransport never throws and never opens a store", () => {
  test("absent credential: reports absent, the default authority, and one CREDENTIAL_ABSENT error", () => {
    const described = describeClientTransport("todos", { HOME: "/nonexistent/home" });
    expect(described).toMatchObject({
      app: "todos",
      credential: "absent",
      credentialTier: null,
      credentialSource: null,
      authority: "https://api.hasna.com/todos/v1",
      authoritySource: "default",
      localOptIn: "off",
      localOptInSource: null,
    });
    expect(described.errors.map((error) => error.code)).toEqual(["CREDENTIAL_ABSENT"]);
    expect(described.errors[0]).toBeInstanceOf(ClientResolutionError);
  });

  test("present credential: names the tier and source, never the value", () => {
    const described = describeClientTransport("todos", {
      HASNA_TODOS_API_URL: "https://todos.example.test",
      HASNA_TODOS_API_KEY: "SUPER-SECRET-VALUE",
    });
    expect(described).toMatchObject({
      credential: "present",
      credentialTier: "env",
      credentialSource: "HASNA_TODOS_API_KEY",
      authority: "https://todos.example.test/v1",
      authoritySource: "HASNA_TODOS_API_URL",
      errors: [],
    });
    expect(JSON.stringify(described)).not.toContain("SUPER-SECRET-VALUE");
  });

  test("locked Keychain: BOTH the api-url and api-key item reads are unreadable, and no authority is invented", () => {
    const described = describeClientTransport("todos", { HASNA_STATION: "s" }, darwin(locked));
    expect(described.credential).toBe("unreadable");
    // The authority ladder reads the Keychain `api-url` item before the chain
    // reads `api-key`; a locked Keychain fails both, and each is reported.
    expect(described.errors.map((error) => error.code)).toEqual(["CREDENTIAL_UNREADABLE", "CREDENTIAL_UNREADABLE"]);
    expect(described.errors.map((error) => error.sources[0])).toEqual([
      "keychain:hasna.credentials.todos.api-url@s",
      "keychain:hasna.credentials.todos.api-key@s",
    ]);
    expect(described.authority).toBeNull();
    // The hint names the `security` status; nothing here is a value.
    expect(described.errors[1]!.message).toContain("security exited 36");
    // A missing item is absent, not unreadable.
    expect(describeClientTransport("todos", { HASNA_STATION: "s" }, darwin(missing)).credential).toBe("absent");
  });

  test("an unsafe credentials file is unreadable, not absent", () => {
    const root = mkdtempSync(join(tmpdir(), "contracts-describe-"));
    try {
      const file = join(root, ".hasna", "todos", "config", "credentials");
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "HASNA_TODOS_API_KEY=disk-key\n", { mode: 0o644 });
      chmodSync(file, 0o644);
      const described = describeClientTransport("todos", { HOME: root });
      expect(described.credential).toBe("unreadable");
      expect(described.errors[0]!.code).toBe("CREDENTIAL_UNREADABLE");
      expect(described.errors[0]!.sources).toEqual([file]);
      expect(JSON.stringify(described)).not.toContain("disk-key");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("authority and credential are reported independently", () => {
    const described = describeClientTransport("todos", { HASNA_TODOS_API_URL: "", HASNA_TODOS_API_KEY: "k" });
    expect(described.credential).toBe("present");
    expect(described.authority).toBeNull();
    expect(described.errors.map((error) => error.code)).toEqual(["AUTHORITY_INVALID"]);
    const conflict = describeClientTransport("todos", {
      HASNA_TODOS_API_URL: "https://a.example.test",
      TODOS_API_URL: "https://b.example.test",
    });
    expect(conflict.errors.map((error) => error.code).sort()).toEqual(["AUTHORITY_CONFLICT", "CREDENTIAL_ABSENT"]);
  });

  test("local opt-in on: the credential chain is not consulted and no Keychain call is made", () => {
    const calls: string[][] = [];
    const run: KeychainCommandRunner = (argv) => {
      calls.push([...argv]);
      return { status: 0, stdout: "kc\n", stderr: "" };
    };
    const described = describeClientTransport("todos", { HASNA_TODOS_LOCAL: "1", HASNA_STATION: "s" }, darwin(run));
    expect(described).toMatchObject({
      credential: "not-consulted",
      localOptIn: "on",
      localOptInSource: "HASNA_TODOS_LOCAL",
      authority: null,
      errors: [],
    });
    expect(calls).toEqual([]);
    const conflict = describeClientTransport("todos", { HASNA_TODOS_LOCAL: "1", HASNA_TODOS_API_KEY: "k" });
    expect(conflict.localOptIn).toBe("conflict");
    expect(conflict.errors.map((error) => error.code)).toEqual(["LOCAL_OPT_IN_CONFLICT"]);
    expect(conflict.errors[0]!.exitCode).toBe(6);
  });

  test("an accessor-backed env is reported, not thrown", () => {
    const env: Record<string, string | undefined> = {};
    Object.defineProperty(env, "HASNA_TODOS_API_KEY", { get: () => "trap", enumerable: true });
    const described = describeClientTransport("todos", env);
    expect(described.credential).toBe("unreadable");
    expect(described.errors[0]!.code).toBe("CREDENTIAL_UNREADABLE");
  });
});
