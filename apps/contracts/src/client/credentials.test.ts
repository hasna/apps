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
  keychainConfigValue,
  resolveCredential,
  type KeychainCommandResult,
  type KeychainCommandRunner,
} from "./credentials.js";

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "contracts-credentials-"));
  roots.push(root);
  return root;
}

/** The ruled layout: `~/.hasna/<app>/config/credentials[-<profile>]`. */
function credentialsPath(root: string, app: string, profile?: string): string {
  return join(root, ".hasna", app, "config", profile ? `credentials-${profile}` : "credentials");
}

function writeOwnerOnly(path: string, body: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function writeCredentials(root: string, app: string, body: string, profile?: string): string {
  return writeOwnerOnly(credentialsPath(root, app, profile), body);
}

/** Count stderr writes during `fn`, letting nothing reach the real stream. */
function stderrWritesDuring(fn: () => void): number {
  const original = process.stderr.write;
  let writes = 0;
  process.stderr.write = ((..._args: unknown[]) => {
    writes += 1;
    return true;
  }) as unknown as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return writes;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("the disk tier is ~/.hasna/<app>/config/credentials (home-layout ruling)", () => {
  test("the sole automatic disk source is the app's credentials file", () => {
    const root = scratch();
    const path = credentialsPath(root, "todos");
    expect(credentialDiskSources("todos", { HOME: root })).toEqual([path]);
    expect(credentialDiskSourceList("todos", { HOME: root })).toEqual([{ path, tier: "disk" }]);
  });

  test("HASNA_HOME replaces ~/.hasna and HASNA_CONFIG_HOME replaces the config root", () => {
    const root = scratch();
    const hasnaHome = join(root, "alt-home");
    const configHome = join(root, "alt-config");
    expect(credentialDiskSources("todos", { HOME: root, HASNA_HOME: hasnaHome })).toEqual([
      join(hasnaHome, "todos", "config", "credentials"),
    ]);
    expect(credentialDiskSources("todos", { HOME: root, HASNA_CONFIG_HOME: configHome })).toEqual([
      join(configHome, "todos", "credentials"),
    ]);
    // The config root is the more specific override, so it wins over the home root.
    expect(
      credentialDiskSources("todos", { HOME: root, HASNA_HOME: hasnaHome, HASNA_CONFIG_HOME: configHome }),
    ).toEqual([join(configHome, "todos", "credentials")]);
    // HASNA_HOME anchors the root on its own; HOME is not required.
    expect(credentialDiskSources("todos", { HASNA_HOME: hasnaHome })).toEqual([
      join(hasnaHome, "todos", "config", "credentials"),
    ]);
    const path = writeOwnerOnly(join(configHome, "todos", "credentials"), "HASNA_TODOS_API_KEY=override-root\n");
    expect(resolveCredential("todos", { HOME: root, HASNA_CONFIG_HOME: configHome })?.source).toBe(path);
  });

  test("overrides follow XDG semantics: a relative or blank value is unset", () => {
    const root = scratch();
    const expected = [credentialsPath(root, "todos")];
    for (const bad of ["", "   ", "relative/dir", "./here"]) {
      expect(credentialDiskSources("todos", { HOME: root, HASNA_HOME: bad })).toEqual(expected);
      expect(credentialDiskSources("todos", { HOME: root, HASNA_CONFIG_HOME: bad })).toEqual(expected);
    }
  });

  test("without HOME or HASNA_HOME there is no disk source and no disk read", () => {
    expect(credentialDiskSources("todos", {})).toEqual([]);
    expect(credentialDiskSources("todos", { HASNA_CONFIG_HOME: "relative" })).toEqual([]);
    expect(resolveCredential("todos", {})).toBeNull();
  });

  test("XDG_CONFIG_HOME and ~/.config/hasna are never consulted", () => {
    const root = scratch();
    const xdg = join(root, "xdg");
    writeOwnerOnly(join(xdg, "hasna", "todos.env"), "HASNA_TODOS_API_KEY=xdg-key\n");
    writeOwnerOnly(join(root, ".config", "hasna", "todos.env"), "HASNA_TODOS_API_KEY=dot-config-key\n");
    const env = { HOME: root, XDG_CONFIG_HOME: xdg };
    expect(credentialDiskSources("todos", env)).toEqual([credentialsPath(root, "todos")]);
    expect(resolveCredential("todos", env)).toBeNull();
  });

  test("retired fleet-env, cloud and *-cloud.env locations under ~/.hasna are ignored", () => {
    const root = scratch();
    for (const retired of [
      join(root, ".hasna", "fleet-env", "todos.env"),
      join(root, ".hasna", "cloud", "todos.env"),
      join(root, ".hasna", "todos", "config", "todos-cloud.env"),
      join(root, ".hasna", "todos", "config", "credentials.env"),
    ]) {
      writeOwnerOnly(retired, "HASNA_TODOS_API_KEY=retired\n");
    }
    expect(resolveCredential("todos", { HOME: root })).toBeNull();
  });

  test("an unsafe app name never composes a path", () => {
    expect(credentialDiskSources("../escape", { HOME: scratch() })).toEqual([]);
  });
});

describe("canonical credential resolution", () => {
  test("reads the owner-only credentials file and seals the secret", () => {
    const root = scratch();
    const path = writeCredentials(root, "todos", "HASNA_TODOS_API_KEY=disk-key\n");
    const resolved = resolveCredential("todos", { HOME: root })!;
    expect(resolved.apiKey).toBe("disk-key");
    expect(resolved.source).toBe(path);
    expect(resolved.tier).toBe("disk");
    expect(resolved.deliberate).toBe(false);
    expect(Object.keys(resolved)).not.toContain("apiKey");
    expect(JSON.stringify(resolved)).not.toContain("disk-key");
  });

  test("re-reads the credentials file on every resolution", () => {
    const root = scratch();
    const path = writeCredentials(root, "todos", "HASNA_TODOS_API_KEY=first\n");
    const env = { HOME: root };
    expect(resolveCredential("todos", env)?.apiKey).toBe("first");
    writeOwnerOnly(path, "HASNA_TODOS_API_KEY=second\n");
    expect(resolveCredential("todos", env)?.apiKey).toBe("second");
  });

  test("refuses group/world-readable files instead of treating them as absent", () => {
    const root = scratch();
    const path = writeCredentials(root, "todos", "HASNA_TODOS_API_KEY=secret\n");
    chmodSync(path, 0o644);
    expect(() => resolveCredential("todos", { HOME: root })).toThrow(CredentialFileUnsafeError);
  });

  test("refuses symlinked credential files", () => {
    const root = scratch();
    const target = join(root, "target");
    writeFileSync(target, "HASNA_TODOS_API_KEY=secret\n", { mode: 0o600 });
    const path = credentialsPath(root, "todos");
    mkdirSync(join(path, ".."), { recursive: true });
    symlinkSync(target, path);
    expect(() => resolveCredential("todos", { HOME: root })).toThrow(CredentialFileUnsafeError);
  });

  test("blank or malformed declarations fail closed", () => {
    const root = scratch();
    writeCredentials(root, "todos", "HASNA_TODOS_API_KEY=\n");
    expect(() => resolveCredential("todos", { HOME: root })).toThrow(CredentialFileUnsafeError);
  });

  test("explicit and override credentials are deliberate and terminal", () => {
    expect(resolveCredential("todos", {}, { apiKey: "explicit" })?.tier).toBe("argument");
    expect(resolveCredential("todos", { HASNA_TODOS_API_KEY_OVERRIDE: "override" })?.tier).toBe("override");
    expect(() => resolveCredential("todos", { HASNA_TODOS_API_KEY_OVERRIDE: " " })).toThrow(
      CredentialResolutionError,
    );
    expect(() => resolveCredential("todos", {}, { apiKey: " " })).toThrow(CredentialResolutionError);
  });

  test("profiles resolve only their own credentials-<profile> file", () => {
    const root = scratch();
    const path = writeCredentials(root, "todos", "HASNA_TODOS_API_KEY=profile-key\n", "operator");
    const resolved = resolveCredential("todos", { HOME: root }, { profile: "operator" })!;
    expect(resolved.source).toBe(path);
    expect(resolved.tier).toBe("profile");
    expect(() => resolveCredential("todos", { HOME: root }, { profile: "../escape" })).toThrow(
      CredentialResolutionError,
    );
    // A missing profile names the exact file it looked for and never falls
    // through to the default file.
    writeCredentials(root, "todos", "HASNA_TODOS_API_KEY=default-key\n");
    let message = "";
    try {
      resolveCredential("todos", { HOME: root, HASNA_PROFILE: "missing" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain(`Looked in: ${credentialsPath(root, "todos", "missing")}`);
    expect(message).not.toContain("default-key");
  });

  test("the process env is a legitimate tier below disk: no notice, no deprecation", () => {
    const writes = stderrWritesDuring(() => {
      const resolved = resolveCredential("todos", { HASNA_TODOS_API_KEY: "env-key" })!;
      expect(resolved.tier).toBe("env");
      expect(resolved.source).toBe("HASNA_TODOS_API_KEY");
      expect(resolved.deliberate).toBe(false);
      expect(resolved.warning).toBeNull();
      expect("deprecated" in resolved).toBe(false);
    });
    expect(writes).toBe(0);
  });

  test("disk outranks the process env, and a disagreement is named without values", () => {
    const root = scratch();
    const path = writeCredentials(root, "todos", "HASNA_TODOS_API_KEY=disk-key\n");
    const resolved = resolveCredential("todos", { HOME: root, HASNA_TODOS_API_KEY: "stale-export" })!;
    expect(resolved.tier).toBe("disk");
    expect(resolved.apiKey).toBe("disk-key");
    expect(resolved.warning).toContain(path);
    expect(resolved.warning).toContain("HASNA_TODOS_API_KEY");
    expect(resolved.warning).not.toContain("stale-export");
    expect(resolved.warning).not.toContain("disk-key");
    // Identical values are not a disagreement.
    expect(resolveCredential("todos", { HOME: root, HASNA_TODOS_API_KEY: "disk-key" })!.warning).toBeNull();
  });

  test("non-secret config reads use the credentials file and never expose credential-shaped keys", () => {
    const root = scratch();
    const path = writeCredentials(
      root,
      "todos",
      "HASNA_TODOS_API_URL=https://todos.example.test\nHASNA_TODOS_API_KEY=secret\n",
    );
    const env = { HOME: root };
    expect(appConfigDiskValue("todos", env, ["HASNA_TODOS_API_URL"])).toEqual({
      key: "HASNA_TODOS_API_URL",
      value: "https://todos.example.test",
      path,
    });
    expect(appConfigDiskValue("todos", env, ["HASNA_TODOS_API_KEY"])).toBeNull();
  });
});

describe("the macOS Keychain tier", () => {
  const SERVICE_KEY = "hasna.credentials.todos.api-key";
  const SERVICE_URL = "hasna.credentials.todos.api-url";
  const NOT_FOUND = "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.";

  /** A fake `security` serving items by `<account>/<service>` and recording every argv. */
  function fakeSecurity(items: Record<string, string | KeychainCommandResult>): {
    run: KeychainCommandRunner;
    calls: string[][];
  } {
    const calls: string[][] = [];
    const run: KeychainCommandRunner = (argv) => {
      calls.push([...argv]);
      const account = argv[argv.indexOf("-a") + 1];
      const service = argv[argv.indexOf("-s") + 1];
      const item = items[`${account}/${service}`];
      if (item === undefined) return { status: 44, stdout: "", stderr: NOT_FOUND };
      return typeof item === "string" ? { status: 0, stdout: `${item}\n`, stderr: "" } : item;
    };
    return { run, calls };
  }

  const darwin = (run: KeychainCommandRunner, extra: Record<string, unknown> = {}) => ({
    keychain: { platform: "darwin", hostname: () => "fixture-host", run, ...extra },
  });

  test("sits between the env pointers and the disk file, and exists only on darwin", () => {
    const root = scratch();
    writeCredentials(root, "todos", "HASNA_TODOS_API_KEY=disk-key\n");
    const env = { HOME: root, HASNA_STATION: "station-fixture", HASNA_TODOS_API_KEY: "env-key" };
    const { run, calls } = fakeSecurity({ [`station-fixture/${SERVICE_KEY}`]: "keychain-key" });

    const resolved = resolveCredential("todos", env, darwin(run))!;
    expect(resolved.tier).toBe("keychain");
    expect(resolved.apiKey).toBe("keychain-key");
    expect(resolved.deliberate).toBe(false);
    expect(resolved.source).toBe(`keychain:${SERVICE_KEY}@station-fixture`);
    expect(calls).toEqual([["find-generic-password", "-a", "station-fixture", "-s", SERVICE_KEY, "-w"]]);
    expect(JSON.stringify(resolved)).not.toContain("keychain-key");
    expect(Bun.inspect(resolved)).not.toContain("keychain-key");

    // Not on other platforms: disk wins and `security` is never run.
    const linux = fakeSecurity({ [`station-fixture/${SERVICE_KEY}`]: "keychain-key" });
    expect(resolveCredential("todos", env, { keychain: { platform: "linux", run: linux.run } })?.tier).toBe("disk");
    expect(linux.calls).toEqual([]);

    // A deliberate pointer above it still wins without consulting it.
    const override = fakeSecurity({ [`station-fixture/${SERVICE_KEY}`]: "keychain-key" });
    expect(
      resolveCredential("todos", { ...env, HASNA_TODOS_API_KEY_OVERRIDE: "override-key" }, darwin(override.run))?.tier,
    ).toBe("override");
    expect(override.calls).toEqual([]);
  });

  test("is re-read on every call and warns, without values, when the env disagrees", () => {
    let value = "kc-one";
    const run: KeychainCommandRunner = () => ({ status: 0, stdout: `${value}\n`, stderr: "" });
    const env = { HASNA_STATION: "s", HASNA_TODOS_API_KEY: "shell-export" };
    const first = resolveCredential("todos", env, darwin(run))!;
    expect(first.apiKey).toBe("kc-one");
    expect(first.warning).toContain("HASNA_TODOS_API_KEY");
    expect(first.warning).toContain(`keychain:${SERVICE_KEY}@s`);
    expect(first.warning).not.toContain("shell-export");
    expect(first.warning).not.toContain("kc-one");
    value = "kc-two";
    expect(resolveCredential("todos", env, darwin(run))!.apiKey).toBe("kc-two");
    expect(resolveCredential("todos", { HASNA_STATION: "s", HASNA_TODOS_API_KEY: "kc-two" }, darwin(run))!.warning).toBeNull();
  });

  test("a missing item falls through; any other security failure is loud and never prints the value", () => {
    const root = scratch();
    writeCredentials(root, "todos", "HASNA_TODOS_API_KEY=disk-key\n");
    const env = { HOME: root, HASNA_STATION: "s" };
    expect(resolveCredential("todos", env, darwin(fakeSecurity({}).run))?.tier).toBe("disk");
    expect(
      resolveCredential("todos", { HASNA_STATION: "s", HASNA_TODOS_API_KEY: "env-key" }, darwin(fakeSecurity({}).run))?.tier,
    ).toBe("env");

    const failures: KeychainCommandResult[] = [
      { status: 36, stdout: "", stderr: "security: SecKeychainSearchCopyNext: User interaction is not allowed." },
      { status: 1, stdout: "SUPER-SECRET-VALUE\n", stderr: "" },
      { status: null, stdout: "", stderr: "spawnSync /usr/bin/security ENOENT" },
      { status: 0, stdout: "\n", stderr: "" },
    ];
    for (const failure of failures) {
      let thrown: unknown;
      try {
        resolveCredential("todos", env, darwin(fakeSecurity({ [`s/${SERVICE_KEY}`]: failure }).run));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CredentialResolutionError);
      const message = String(thrown);
      expect(message).toContain(`keychain:${SERVICE_KEY}@s`);
      expect(message).not.toContain("SUPER-SECRET-VALUE");
      expect(message).not.toContain("disk-key");
    }
    expect(() =>
      resolveCredential(
        "todos",
        env,
        darwin(() => {
          throw new Error("runner exploded");
        }),
      ),
    ).toThrow(CredentialResolutionError);
  });

  test("the account is HASNA_STATION, else the short hostname, else USER", () => {
    const accountsUsed = (env: Record<string, string>, hostname: string): string[] => {
      const { run, calls } = fakeSecurity({});
      resolveCredential("todos", env, { keychain: { platform: "darwin", hostname: () => hostname, run } });
      return calls.map((argv) => argv[2]!);
    };
    expect(accountsUsed({ HASNA_STATION: "station01", USER: "u" }, "mac.local")).toEqual(["station01"]);
    expect(accountsUsed({ USER: "u" }, "mac.local")).toEqual(["mac"]);
    expect(accountsUsed({ HASNA_STATION: "  ", USER: "u" }, "")).toEqual(["u"]);
    // Nothing to name an account: the tier is absent, and no lookup is attempted.
    expect(accountsUsed({}, "")).toEqual([]);
  });

  test("a caller-built env never reaches the Keychain unless a runner is injected or the tier is enabled", () => {
    // No runner and a caller-built env: the real `security` must not run.
    // (Observable here only as "absent, no error" — the fixture station name
    // has no item — but the gate is what keeps every other test in this
    // package off the machine's login keychain.)
    expect(
      resolveCredential("todos", { HASNA_STATION: "station-fixture" }, { keychain: { platform: "darwin", hostname: () => "h" } }),
    ).toBeNull();
    const { run, calls } = fakeSecurity({ [`h/${SERVICE_KEY}`]: "kc" });
    // `enabled: false` wins over an injected runner.
    expect(resolveCredential("todos", {}, { keychain: { platform: "darwin", hostname: () => "h", run, enabled: false } })).toBeNull();
    expect(calls).toEqual([]);
    expect(
      resolveCredential("todos", {}, { keychain: { platform: "darwin", hostname: () => "h", run, enabled: true } })?.apiKey,
    ).toBe("kc");
  });

  test("the api-url item is read the same way for the authority ladder", () => {
    const { run, calls } = fakeSecurity({ [`s/${SERVICE_URL}`]: "https://gateway.example.test/todos" });
    const env = { HASNA_STATION: "s" };
    expect(keychainConfigValue("todos", env, { platform: "darwin", run })).toEqual({
      value: "https://gateway.example.test/todos",
      source: `keychain:${SERVICE_URL}@s`,
    });
    expect(calls).toEqual([["find-generic-password", "-a", "s", "-s", SERVICE_URL, "-w"]]);
    expect(keychainConfigValue("todos", env, { platform: "darwin", run: fakeSecurity({}).run })).toBeNull();
    expect(keychainConfigValue("todos", env, { platform: "linux", run })).toBeNull();
  });
});
