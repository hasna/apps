import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CredentialFileUnsafeError,
  CredentialResolutionError,
  appConfigDiskValue,
  credentialDiskSourceList,
  credentialDiskSources,
  resolveCredential,
} from "./credentials.js";

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "contracts-credentials-"));
  roots.push(root);
  return root;
}

function writeConfig(root: string, app: string, body: string, profile?: string): string {
  const directory = join(root, "config", "hasna");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${app}${profile ? `-${profile}` : ""}.env`);
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("canonical credential resolution", () => {
  test("uses only the XDG config path as an automatic disk source", () => {
    const root = scratch();
    const env = { HOME: root, XDG_CONFIG_HOME: join(root, "config") };
    expect(credentialDiskSources("todos", env)).toEqual([join(root, "config", "hasna", "todos.env")]);
    expect(credentialDiskSourceList("todos", env)).toEqual([
      { path: join(root, "config", "hasna", "todos.env"), tier: "config", deprecated: false },
    ]);
  });

  test("ignores retired ~/.hasna credential locations", () => {
    const root = scratch();
    const legacy = join(root, ".hasna", "fleet-env");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "todos.env"), "HASNA_TODOS_API_KEY=retired\n", { mode: 0o600 });
    expect(resolveCredential("todos", { HOME: root })).toBeNull();
  });

  test("reads owner-only XDG credentials and seals the secret", () => {
    const root = scratch();
    const path = writeConfig(root, "todos", "HASNA_TODOS_API_KEY=disk-key\n");
    const resolved = resolveCredential("todos", { HOME: root, XDG_CONFIG_HOME: join(root, "config") })!;
    expect(resolved.apiKey).toBe("disk-key");
    expect(resolved.source).toBe(path);
    expect(resolved.tier).toBe("config");
    expect(Object.keys(resolved)).not.toContain("apiKey");
    expect(JSON.stringify(resolved)).not.toContain("disk-key");
  });

  test("re-reads the XDG credential on every resolution", () => {
    const root = scratch();
    const path = writeConfig(root, "todos", "HASNA_TODOS_API_KEY=first\n");
    const env = { HOME: root, XDG_CONFIG_HOME: join(root, "config") };
    expect(resolveCredential("todos", env)?.apiKey).toBe("first");
    writeFileSync(path, "HASNA_TODOS_API_KEY=second\n", { mode: 0o600 });
    chmodSync(path, 0o600);
    expect(resolveCredential("todos", env)?.apiKey).toBe("second");
  });

  test("refuses group/world-readable files instead of treating them as absent", () => {
    const root = scratch();
    const path = writeConfig(root, "todos", "HASNA_TODOS_API_KEY=secret\n");
    chmodSync(path, 0o644);
    expect(() => resolveCredential("todos", { HOME: root, XDG_CONFIG_HOME: join(root, "config") })).toThrow(
      CredentialFileUnsafeError,
    );
  });

  test("refuses symlinked credential files", () => {
    const root = scratch();
    const target = join(root, "target.env");
    writeFileSync(target, "HASNA_TODOS_API_KEY=secret\n", { mode: 0o600 });
    const path = join(root, "config", "hasna", "todos.env");
    mkdirSync(join(root, "config", "hasna"), { recursive: true });
    symlinkSync(target, path);
    expect(() => resolveCredential("todos", { HOME: root, XDG_CONFIG_HOME: join(root, "config") })).toThrow(
      CredentialFileUnsafeError,
    );
  });

  test("blank or malformed declarations fail closed", () => {
    const root = scratch();
    writeConfig(root, "todos", "HASNA_TODOS_API_KEY=\n");
    expect(() => resolveCredential("todos", { HOME: root, XDG_CONFIG_HOME: join(root, "config") })).toThrow(
      CredentialFileUnsafeError,
    );
  });

  test("explicit and override credentials are deliberate and terminal", () => {
    expect(resolveCredential("todos", {}, { apiKey: "explicit" })?.tier).toBe("argument");
    expect(resolveCredential("todos", { HASNA_TODOS_API_KEY_OVERRIDE: "override" })?.tier).toBe("override");
    expect(() => resolveCredential("todos", { HASNA_TODOS_API_KEY_OVERRIDE: " " })).toThrow(
      CredentialResolutionError,
    );
    expect(() => resolveCredential("todos", {}, { apiKey: " " })).toThrow(CredentialResolutionError);
  });

  test("profiles resolve only their owner-only XDG file", () => {
    const root = scratch();
    const path = writeConfig(root, "todos", "HASNA_TODOS_API_KEY=profile-key\n", "operator");
    const resolved = resolveCredential(
      "todos",
      { HOME: root, XDG_CONFIG_HOME: join(root, "config") },
      { profile: "operator" },
    )!;
    expect(resolved.source).toBe(path);
    expect(resolved.tier).toBe("profile");
    expect(() => resolveCredential("todos", { HOME: root }, { profile: "../escape" })).toThrow(
      CredentialResolutionError,
    );
  });

  test("legacy process env remains a deprecated credential input, never a transport selector", () => {
    const resolved = resolveCredential("todos", { HASNA_TODOS_API_KEY: "legacy-env-key" }, { onDeprecation: () => {} })!;
    expect(resolved.tier).toBe("legacy-env");
    expect(resolved.deprecated).toBe(true);
  });

  test("non-secret config reads are XDG-only and never expose credential-shaped keys", () => {
    const root = scratch();
    const path = writeConfig(
      root,
      "todos",
      "HASNA_TODOS_API_URL=https://todos.example.test\nHASNA_TODOS_API_KEY=secret\n",
    );
    const env = { HOME: root, XDG_CONFIG_HOME: join(root, "config") };
    expect(appConfigDiskValue("todos", env, ["HASNA_TODOS_API_URL"])).toEqual({
      key: "HASNA_TODOS_API_URL",
      value: "https://todos.example.test",
      path,
    });
    expect(appConfigDiskValue("todos", env, ["HASNA_TODOS_API_KEY"])).toBeNull();
  });
});
