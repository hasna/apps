import { describe, it, expect } from "bun:test";
import {
  ALLOW_ANONYMOUS_ENV_VAR,
  AUTH_ENV_VAR,
  AuthNotConfiguredError,
  describeAuthPosture,
  isAnonymousOptInEnv,
  isLoopbackAddress,
  isLoopbackHost,
  resolveAuthPosture,
  resolveServerKeyEnv,
  SERVER_API_KEY_ENV_VAR,
  SERVER_API_KEY_FALLBACK_ENV_VARS,
} from "./auth-posture.js";

const base = { apiKey: null, hasGeneratedKeys: false, host: "127.0.0.1", allowAnonymous: false, hosted: false };

describe("isLoopbackHost", () => {
  it("treats an unset host as loopback (startServer's default bind)", () => {
    expect(isLoopbackHost(undefined)).toBe(true);
    expect(isLoopbackHost("")).toBe(true);
  });

  it("accepts loopback names and addresses", () => {
    for (const host of ["127.0.0.1", "127.5.6.7", "localhost", "LOCALHOST", "::1", "[::1]"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it("rejects off-box binds", () => {
    for (const host of ["0.0.0.0", "::", "10.0.1.5", "172.31.85.234", "example.com", "127.0.0.1.evil.com"]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe("isLoopbackAddress", () => {
  it("recognizes IPv4, IPv6 and IPv4-mapped loopback peers", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.0.0.53")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("[::1]")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects non-loopback and malformed peers", () => {
    for (const address of [undefined, "", "unknown", "0.0.0.0", "10.0.0.1", "172.31.85.234", "128.0.0.1", "1270.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isLoopbackAddress(address)).toBe(false);
    }
  });
});

describe("isAnonymousOptInEnv", () => {
  it("only honors explicit truthy values", () => {
    expect(isAnonymousOptInEnv({})).toBe(false);
    expect(isAnonymousOptInEnv({ [ALLOW_ANONYMOUS_ENV_VAR]: "" })).toBe(false);
    expect(isAnonymousOptInEnv({ [ALLOW_ANONYMOUS_ENV_VAR]: "0" })).toBe(false);
    expect(isAnonymousOptInEnv({ [ALLOW_ANONYMOUS_ENV_VAR]: "false" })).toBe(false);
    expect(isAnonymousOptInEnv({ [ALLOW_ANONYMOUS_ENV_VAR]: "1" })).toBe(true);
    expect(isAnonymousOptInEnv({ [ALLOW_ANONYMOUS_ENV_VAR]: "TRUE" })).toBe(true);
  });
});

describe("resolveAuthPosture", () => {
  it("FAILS CLOSED: no credential, no opt-in => refuses to start", () => {
    expect(() => resolveAuthPosture(base)).toThrow(AuthNotConfiguredError);
    // The old fail-open bug was exactly this input returning "authorized".
    try {
      resolveAuthPosture(base);
      throw new Error("expected resolveAuthPosture to throw");
    } catch (error) {
      expect((error as AuthNotConfiguredError).code).toBe("AUTH_NOT_CONFIGURED");
      expect((error as Error).message).toContain(AUTH_ENV_VAR);
      expect((error as Error).message).toContain("refusing to start");
    }
  });

  it("refuses to start when unconfigured on an off-box bind", () => {
    expect(() => resolveAuthPosture({ ...base, host: "0.0.0.0" })).toThrow(AuthNotConfiguredError);
  });

  it("enforces when a static key is configured", () => {
    expect(resolveAuthPosture({ ...base, apiKey: "k" }).mode).toBe("enforce");
    expect(resolveAuthPosture({ ...base, apiKey: "k", host: "0.0.0.0" }).mode).toBe("enforce");
  });

  it("enforces when a generated key exists", () => {
    expect(resolveAuthPosture({ ...base, hasGeneratedKeys: true }).mode).toBe("enforce");
  });

  it("a configured credential always wins over the anonymous opt-in", () => {
    expect(resolveAuthPosture({ ...base, apiKey: "k", allowAnonymous: true }).mode).toBe("enforce");
    expect(resolveAuthPosture({ ...base, hasGeneratedKeys: true, allowAnonymous: true }).mode).toBe("enforce");
  });

  it("allows the anonymous plane only on a loopback bind, and only when opted in", () => {
    expect(resolveAuthPosture({ ...base, allowAnonymous: true }).mode).toBe("anonymous-loopback");
    expect(resolveAuthPosture({ ...base, allowAnonymous: true, host: undefined }).mode).toBe("anonymous-loopback");
  });

  it("REFUSES the anonymous opt-in on an off-box bind", () => {
    for (const host of ["0.0.0.0", "::", "10.0.1.5", "example.com"]) {
      expect(() => resolveAuthPosture({ ...base, allowAnonymous: true, host }))
        .toThrow(/--allow-anonymous is refused/);
    }
  });

  it("hosted + no local credential => local planes disabled (never an anonymous plane)", () => {
    const posture = resolveAuthPosture({ ...base, hosted: true, host: "0.0.0.0" });
    expect(posture.mode).toBe("local-plane-disabled");
    // The anonymous opt-in cannot resurrect the local planes on a hosted deployment.
    expect(resolveAuthPosture({ ...base, hosted: true, host: "0.0.0.0", allowAnonymous: true }).mode)
      .toBe("local-plane-disabled");
    expect(resolveAuthPosture({ ...base, hosted: true, host: "127.0.0.1", allowAnonymous: true }).mode)
      .toBe("local-plane-disabled");
  });

  it("hosted + a local credential => enforce", () => {
    expect(resolveAuthPosture({ ...base, hosted: true, host: "0.0.0.0", apiKey: "k" }).mode).toBe("enforce");
  });

  it("never returns a posture that serves data anonymously off-box", () => {
    for (const host of ["0.0.0.0", "::", "10.0.1.5", "172.31.85.234", "example.com"]) {
      for (const allowAnonymous of [false, true]) {
        for (const hosted of [false, true]) {
          let mode: string | null = null;
          try {
            mode = resolveAuthPosture({ ...base, host, allowAnonymous, hosted }).mode;
          } catch (error) {
            expect(error).toBeInstanceOf(AuthNotConfiguredError);
          }
          expect(mode).not.toBe("anonymous-loopback");
        }
      }
    }
  });

  it("describeAuthPosture names the env var operators need", () => {
    expect(describeAuthPosture({ mode: "local-plane-disabled", reason: "r" })).toContain(AUTH_ENV_VAR);
    expect(describeAuthPosture({ mode: "anonymous-loopback", reason: "r" })).toContain(AUTH_ENV_VAR);
    expect(describeAuthPosture({ mode: "enforce", reason: "r" })).toContain("ENFORCED");
  });

  it("the enforce reason names the env variable that supplied the static key", () => {
    const posture = resolveAuthPosture({
      ...base,
      apiKey: "k",
      apiKeySourceLabel: SERVER_API_KEY_ENV_VAR,
    });
    expect(posture.mode).toBe("enforce");
    expect(posture.reason).toContain(SERVER_API_KEY_ENV_VAR);
  });

  it("the enforce reason flags a key that arrived via a deprecated fallback name", () => {
    const posture = resolveAuthPosture({
      ...base,
      apiKey: "k",
      apiKeySourceLabel: "TODOS_API_KEY (deprecated server credential — set HASNA_TODOS_SERVER_API_KEY)",
    });
    expect(posture.reason).toContain("TODOS_API_KEY");
    expect(posture.reason).toContain("deprecated");
    expect(posture.reason).toContain(SERVER_API_KEY_ENV_VAR);
  });

  it("the enforce reason falls back to naming the env var/--api-key when no label is given", () => {
    const posture = resolveAuthPosture({ ...base, apiKey: "k" });
    expect(posture.reason).toContain(AUTH_ENV_VAR);
  });
});

describe("resolveServerKeyEnv", () => {
  it("prefers the server's own canonical variable over the client credential names", () => {
    const resolution = resolveServerKeyEnv({
      [SERVER_API_KEY_ENV_VAR]: "server-key",
      HASNA_TODOS_API_KEY: "client-canonical",
      TODOS_API_KEY: "client-legacy",
    });
    expect(resolution).not.toBeNull();
    expect(resolution!.value).toBe("server-key");
    expect(resolution!.variable).toBe(SERVER_API_KEY_ENV_VAR);
    expect(resolution!.deprecated).toBe(false);
    expect(resolution!.label).toBe(SERVER_API_KEY_ENV_VAR);
  });

  it("falls back to the client canonical name, then the client legacy name", () => {
    const canonicalClient = resolveServerKeyEnv({
      HASNA_TODOS_API_KEY: "client-canonical",
      TODOS_API_KEY: "client-legacy",
    });
    expect(canonicalClient!.variable).toBe(SERVER_API_KEY_FALLBACK_ENV_VARS[0]);
    expect(canonicalClient!.deprecated).toBe(true);
    expect(canonicalClient!.label).toContain(SERVER_API_KEY_ENV_VAR);

    const legacyClient = resolveServerKeyEnv({ TODOS_API_KEY: "client-legacy" });
    expect(legacyClient!.variable).toBe(SERVER_API_KEY_FALLBACK_ENV_VARS[1]);
    expect(legacyClient!.value).toBe("client-legacy");
    expect(legacyClient!.deprecated).toBe(true);
  });

  it("a set-but-empty canonical variable suppresses the fallbacks (`??` semantics)", () => {
    const resolution = resolveServerKeyEnv({
      [SERVER_API_KEY_ENV_VAR]: "",
      TODOS_API_KEY: "client-legacy",
    });
    expect(resolution).not.toBeNull();
    expect(resolution!.value).toBe("");
    expect(resolution!.variable).toBe(SERVER_API_KEY_ENV_VAR);
    expect(resolution!.deprecated).toBe(false);
  });

  it("returns null when no server credential variable is set", () => {
    expect(resolveServerKeyEnv({})).toBeNull();
    expect(resolveServerKeyEnv({ HASNA_TODOS_PROFILE: "x" })).toBeNull();
  });
});
