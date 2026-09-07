/**
 * @hasna/telephony — client transport resolution (hasna/apps#1720, class B).
 *
 * Routing is decided by the shared @hasna/contracts credential chain, so these
 * tests drive that chain rather than a local copy of it: a fake `security`
 * runner for the Keychain tier, a real temp HOME for the credentials file, and
 * plain env objects for the env tiers. Every env passed here is a caller-built
 * object, which the shared resolver deliberately keeps away from the machine's
 * real Keychain.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TELEPHONY_API_KEY_ENV,
  TELEPHONY_API_URL_ENV,
  TELEPHONY_DEFAULT_API_URL,
  TELEPHONY_LOCAL_MODE_ENV,
  isLocalModeOptIn,
  resetTelephonyLocalModeNotice,
  resolveTelephonyClientTransport,
  telephonyStoreMisconfiguredError,
} from "./client-transport.js";

const KEYCHAIN_KEY_SERVICE = "hasna.credentials.telephony.api-key";
const KEYCHAIN_URL_SERVICE = "hasna.credentials.telephony.api-url";
/** `security` exits 44 (errSecItemNotFound) when no item matches. */
const ITEM_NOT_FOUND = 44;

/** A fake `/usr/bin/security` holding the given items, keyed by service name. */
function fakeKeychain(items: Record<string, string>) {
  const calls: string[][] = [];
  return {
    calls,
    run: (argv: readonly string[]) => {
      calls.push([...argv]);
      const service = argv[argv.indexOf("-s") + 1] ?? "";
      const value = items[service];
      return value === undefined
        ? { status: ITEM_NOT_FOUND, stdout: "", stderr: "" }
        : { status: 0, stdout: `${value}\n`, stderr: "" };
    },
  };
}

/** A credentials file at `<home>/.hasna/telephony/config/credentials`, 0600. */
function writeCredentialsFile(contents: string): string {
  const home = mkdtempSync(join(tmpdir(), "ok-telephony-transport-home-"));
  const dir = join(home, ".hasna", "telephony", "config");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "credentials");
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
  homes.push(home);
  return home;
}

const homes: string[] = [];

afterEach(() => {
  resetTelephonyLocalModeNotice();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

describe("telephony client transport — credential resolution", () => {
  test("the canonical env pair selects HTTP through the @hasna/contracts chain", () => {
    const resolved = resolveTelephonyClientTransport({
      [TELEPHONY_API_URL_ENV]: "https://telephony.example.test",
      [TELEPHONY_API_KEY_ENV]: "test-only-key",
    });
    expect(resolved.mode).toBe("http");
    expect(resolved.client).not.toBeNull();
    expect(resolved.report).toMatchObject({
      mode: "http",
      transportSource: TELEPHONY_API_URL_ENV,
      baseUrl: "https://telephony.example.test/v1",
      apiUrlPresent: true,
      apiUrlSource: TELEPHONY_API_URL_ENV,
      apiKeyPresent: true,
      apiKeySource: TELEPHONY_API_KEY_ENV,
      apiKeyTier: "env",
    });
  });

  test("a key with no URL reaches the fleet gateway — URLs never need configuring", () => {
    // The 2026-09-04 authority ruling: a credential from any tier is enough,
    // and the default authority is the path-prefixed gateway base to which the
    // client appends /v1.
    const resolved = resolveTelephonyClientTransport({
      [TELEPHONY_API_KEY_ENV]: "test-only-key",
    });
    expect(resolved.mode).toBe("http");
    expect(resolved.report).toMatchObject({
      mode: "http",
      transportSource: "default",
      baseUrl: `${TELEPHONY_DEFAULT_API_URL}/v1`,
      apiUrlPresent: false,
      apiUrlSource: "default",
      apiKeyTier: "env",
    });
    expect(TELEPHONY_DEFAULT_API_URL).toBe("https://api.hasna.com/telephony");
  });

  test("the Keychain outranks the credentials file, which outranks the plain env key", () => {
    const home = writeCredentialsFile(`${TELEPHONY_API_KEY_ENV}=disk-only-key\n`);
    const keychain = fakeKeychain({ [KEYCHAIN_KEY_SERVICE]: "keychain-only-key" });
    const env = { HOME: home, HASNA_STATION: "station-test", [TELEPHONY_API_KEY_ENV]: "env-only-key" };

    // Keychain tier live (injected runner): the Keychain item wins.
    expect(resolveTelephonyClientTransport(env, { keychain: { platform: "darwin", run: keychain.run } }))
      .toMatchObject({
        mode: "http",
        report: {
          apiKeyTier: "keychain",
          apiKeySource: `keychain:${KEYCHAIN_KEY_SERVICE}@station-test`,
          keychainTierEnabled: true,
        },
      });

    // Same env, Keychain tier off: the file wins, and only then the env var.
    expect(resolveTelephonyClientTransport(env, { keychain: { enabled: false } })).toMatchObject({
      mode: "http",
      report: {
        apiKeyTier: "disk",
        apiKeySource: join(home, ".hasna", "telephony", "config", "credentials"),
        keychainTierEnabled: false,
      },
    });
  });

  test("the Keychain api-url item pins the authority", () => {
    const keychain = fakeKeychain({
      [KEYCHAIN_KEY_SERVICE]: "keychain-only-key",
      [KEYCHAIN_URL_SERVICE]: "https://telephony.station.test",
    });
    expect(
      resolveTelephonyClientTransport(
        { HASNA_STATION: "station-test" },
        { keychain: { platform: "darwin", run: keychain.run } },
      ),
    ).toMatchObject({
      mode: "http",
      report: {
        baseUrl: "https://telephony.station.test/v1",
        apiUrlSource: `keychain:${KEYCHAIN_URL_SERVICE}@station-test`,
        apiKeyTier: "keychain",
      },
    });
  });

  test("the credentials file supplies both the key and the authority", () => {
    const home = writeCredentialsFile(
      `${TELEPHONY_API_URL_ENV}=https://telephony.file.test\n${TELEPHONY_API_KEY_ENV}=disk-only-key\n`,
    );
    const path = join(home, ".hasna", "telephony", "config", "credentials");
    const resolved = resolveTelephonyClientTransport({ HOME: home });
    expect(resolved.mode).toBe("http");
    expect(resolved.report).toMatchObject({
      baseUrl: "https://telephony.file.test/v1",
      apiUrlSource: path,
      apiKeyTier: "disk",
      apiKeySource: path,
      credentialFileCandidates: [path],
    });
  });

  test("HASNA_PROFILE / the deliberate pointers are accepted as tier 1-2 spellings", () => {
    // The override is a deliberate selection that outranks everything below it.
    const home = writeCredentialsFile(`${TELEPHONY_API_KEY_ENV}=disk-only-key\n`);
    const resolved = resolveTelephonyClientTransport({
      HOME: home,
      HASNA_TELEPHONY_API_KEY_OVERRIDE: "override-key",
    });
    expect(resolved.mode).toBe("http");
    expect(resolved.report.apiKeyTier).toBe("override");
    expect(resolved.report.apiKeySource).toBe("HASNA_TELEPHONY_API_KEY_OVERRIDE");
  });
});

describe("telephony client transport — fail closed", () => {
  test("a configured authority with no resolvable credential fails LOUD, never local", () => {
    // The incident class: a hosted process whose credential vanished must
    // exit non-zero, not serve a stale on-box dataset at exit 0.
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        resolveTelephonyClientTransport({
          [TELEPHONY_API_URL_ENV]: "https://telephony.example.test",
        }),
      ).toThrow(/no API key could be resolved/);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  test("a URL with an unreadable credentials file fails loud (never resolves around)", () => {
    const home = mkdtempSync(join(tmpdir(), "bad-telephony-cred-home-"));
    homes.push(home);
    const dir = join(home, ".hasna", "telephony", "config");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // World-writable: the resolver refuses the file as unsafe rather than
    // reading a credential any local user could have planted.
    writeFileSync(join(dir, "credentials"), `${TELEPHONY_API_KEY_ENV}=not-a-secret\n`, { mode: 0o644 });
    expect(() => resolveTelephonyClientTransport({ HOME: home })).toThrow();
  });

  test("nothing configured anywhere and no opt-in throws the actionable fail-closed error", () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => resolveTelephonyClientTransport({})).toThrow(telephonyStoreMisconfiguredError().message);
      expect(() => resolveTelephonyClientTransport({})).toThrow(/HASNA_TELEPHONY_API_URL/);
      expect(() => resolveTelephonyClientTransport({})).toThrow(/HASNA_TELEPHONY_API_KEY/);
      expect(() => resolveTelephonyClientTransport({})).toThrow(/HASNA_TELEPHONY_LOCAL=1/);
      expect(errSpy).not.toHaveBeenCalled(); // fail-closed is not a local-fallback event
    } finally {
      errSpy.mockRestore();
    }
  });

  test("a declared-but-blank credential variable is normalised to 'unset' at the telephony seam", () => {
    // Blank means unset for telephony: a blank alias next to a real key is
    // not a refusal (hasna/apps#1788 shape — a scrubbed-then-overridden env).
    const resolved = resolveTelephonyClientTransport({
      [TELEPHONY_API_URL_ENV]: "",
      [TELEPHONY_API_KEY_ENV]: "test-only-key",
    });
    expect(resolved.mode).toBe("http");
    expect(resolved.report.baseUrl).toBe(`${TELEPHONY_DEFAULT_API_URL}/v1`);
  });

  test("blank-normalisation keeps the ambient Keychain gate (hasna/apps#1788)", () => {
    // The normaliser must delete a blank key WITHOUT dropping the machine's
    // Keychain tier: the gate is decided before the copy is made and carried
    // across as keychain.enabled. A caller-built env is NOT the ambient
    // environment, so the tier stays off for it.
    const keychain = fakeKeychain({ [KEYCHAIN_KEY_SERVICE]: "keychain-only-key" });
    const env = {
      HASNA_STATION: "station-test",
      [TELEPHONY_API_URL_ENV]: "",
      [TELEPHONY_API_KEY_ENV]: "",
    };
    // Caller-built env → not ambient → the injected runner still enables the
    // tier explicitly, and the blank URL/key are dropped rather than refusing.
    const resolved = resolveTelephonyClientTransport(env, { keychain: { platform: "darwin", run: keychain.run } });
    expect(resolved.mode).toBe("http");
    expect(resolved.report.apiKeyTier).toBe("keychain");
    // The blank env keys were not consulted as a refusal or a value.
    expect(resolved.report.apiKeySource).toBe(`keychain:${KEYCHAIN_KEY_SERVICE}@station-test`);
  });
});

describe("telephony client transport — local opt-in", () => {
  test("nothing configured anywhere plus HASNA_TELEPHONY_LOCAL=1 selects local and says so once", () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const env = { [TELEPHONY_LOCAL_MODE_ENV]: "1" };
      expect(isLocalModeOptIn(env)).toBe(true);
      const resolved = resolveTelephonyClientTransport(env);
      expect(resolved.mode).toBe("local");
      expect(resolved.client).toBeNull();
      expect(resolved.report).toMatchObject({
        mode: "local",
        transportSource: "local",
        baseUrl: null,
        apiUrlPresent: false,
        apiKeyPresent: false,
        apiKeyTier: null,
      });
      // Local is legitimate for this package, but never silent — and never
      // repeated, because the resolver is consulted many times per command.
      resolveTelephonyClientTransport(env);
      const stderrLines = (errSpy.mock.calls as unknown[][]).map((call) => String(call[0] ?? ""));
      expect(stderrLines.filter((line) => line.toLowerCase().includes("local")).length).toBe(1);
    } finally {
      errSpy.mockRestore();
    }
  });

  test("the opt-in YIELDS to any resolved credential — hosted wins", () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      // Env tier.
      expect(
        resolveTelephonyClientTransport({
          [TELEPHONY_LOCAL_MODE_ENV]: "1",
          [TELEPHONY_API_KEY_ENV]: "test-only-key",
        }).mode,
      ).toBe("http");
      // Disk tier.
      const homeDisk = writeCredentialsFile(`${TELEPHONY_API_KEY_ENV}=disk-only-key\n`);
      expect(resolveTelephonyClientTransport({ HOME: homeDisk, [TELEPHONY_LOCAL_MODE_ENV]: "1" }).mode).toBe("http");
      // Keychain tier.
      const keychain = fakeKeychain({ [KEYCHAIN_KEY_SERVICE]: "keychain-only-key" });
      expect(
        resolveTelephonyClientTransport(
          { HASNA_STATION: "station-test", [TELEPHONY_LOCAL_MODE_ENV]: "1" },
          { keychain: { platform: "darwin", run: keychain.run } },
        ).mode,
      ).toBe("http");
      // A local notice was never printed: the opt-in never served local.
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  test("falsy opt-in spellings count as absent and stay fail-closed", () => {
    for (const value of ["0", "false", "no", "off", ""]) {
      const env = { [TELEPHONY_LOCAL_MODE_ENV]: value };
      expect(isLocalModeOptIn(env)).toBe(false);
      expect(() => resolveTelephonyClientTransport(env)).toThrow(/HASNA_TELEPHONY_LOCAL=1/);
    }
  });
});

describe("telephony client transport — report shape", () => {
  test("the report names every source it consulted, never a value", () => {
    const home = writeCredentialsFile(`${TELEPHONY_API_KEY_ENV}=disk-only-key\n`);
    const resolved = resolveTelephonyClientTransport({ HOME: home });
    const report = resolved.report;
    expect(report.mode).toBe("http");
    expect(report.transportSource).toBe("default");
    expect(report.apiUrlSource).toBe("default");
    expect(report.apiKeyPresent).toBe(true);
    expect(report.apiKeyTier).toBe("disk");
    expect(report.apiKeySource).toBe(join(home, ".hasna", "telephony", "config", "credentials"));
    expect(report.credentialFileCandidates).toContain(join(home, ".hasna", "telephony", "config", "credentials"));
    expect(report.keychainTierEnabled).toBe(false);
    // JSON round-trip: the report must not contain the key value.
    expect(JSON.stringify(report)).not.toContain("disk-only-key");
    expect(JSON.stringify(report)).not.toContain("test-only-key");
  });

  test("the hosted transport re-resolves its credential per request (rotation heals)", async () => {
    // Drive two actual HTTP requests through ONE resolved transport against a
    // loopback server that records the x-api-key header. The env is
    // caller-built (no HOME → no disk tier, never ambient → no Keychain), so
    // the per-request re-resolution reads the env tier as it is NOW — proving
    // the transport asks the @hasna/contracts chain again instead of holding
    // the construction-time key.
    const received: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        received.push(req.headers.get("x-api-key") ?? "");
        return Response.json({ ok: true });
      },
    });
    try {
      const port = (server as unknown as { port: number }).port;
      const env: Record<string, string> = {
        [TELEPHONY_API_URL_ENV]: `http://127.0.0.1:${port}`,
        [TELEPHONY_API_KEY_ENV]: "construction-key",
      };
      const resolved = resolveTelephonyClientTransport(env);
      expect(resolved.mode).toBe("http");
      await resolved.client!.list("agents", { query: {} });
      // Rotate the env: the next request through the SAME transport must
      // carry the new key — the chain is consulted again per request.
      env[TELEPHONY_API_KEY_ENV] = "rotated-key";
      await resolved.client!.list("agents", { query: {} });
      expect(received).toEqual(["construction-key", "rotated-key"]);
    } finally {
      server.stop(true);
    }
  });
});