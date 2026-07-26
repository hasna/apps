import { describe, expect, test } from "bun:test";
import {
  ALLOW_ANONYMOUS_ENV_VAR,
  AuthNotConfiguredError,
  SERVE_AUTH_ENV_VARS,
  authorizeLocalPlane,
  isAnonymousOptInEnv,
  isLoopbackAddress,
  isLoopbackHost,
  presentedCredential,
  resolveAuthPosture,
  resolveServeCredential,
  SplitStorePlaneError,
  timingSafeEqual,
  type AuthPosture,
} from "./auth-posture.js";

const CREDENTIAL = "serve-key-for-tests-only";

function posture(overrides: Partial<Parameters<typeof resolveAuthPosture>[0]> = {}): AuthPosture {
  return resolveAuthPosture({
    credential: null,
    host: "127.0.0.1",
    allowAnonymous: false,
    hosted: false,
    localPlaneTransport: "cloud-http",
    ...overrides,
  });
}

describe("auth posture matrix", () => {
  test("a serve credential always yields enforce", () => {
    for (const hosted of [true, false]) {
      for (const host of ["127.0.0.1", "0.0.0.0", undefined]) {
        for (const allowAnonymous of [true, false]) {
          const p = posture({ credential: CREDENTIAL, hosted, host, allowAnonymous });
          expect(p.mode).toBe("enforce");
          expect(p.credential).toBe(CREDENTIAL);
        }
      }
    }
  });

  test("hosted with no credential disables the local plane (never anonymous)", () => {
    for (const host of ["0.0.0.0", "127.0.0.1", undefined]) {
      for (const allowAnonymous of [true, false]) {
        expect(posture({ hosted: true, host, allowAnonymous }).mode).toBe("local-plane-disabled");
      }
    }
  });

  test("--allow-anonymous is accepted only on a loopback bind", () => {
    for (const host of ["127.0.0.1", "localhost", "::1", "127.0.0.53", undefined, ""]) {
      expect(posture({ allowAnonymous: true, host }).mode).toBe("anonymous-loopback");
    }
  });

  test("--allow-anonymous is REFUSED on any off-box bind", () => {
    for (const host of ["0.0.0.0", "::", "10.0.1.7", "calendar.hasna.xyz", "192.168.1.4"]) {
      expect(() => posture({ allowAnonymous: true, host })).toThrow(AuthNotConfiguredError);
    }
  });

  test("nothing configured: refuse to start rather than serve anonymously", () => {
    let thrown: unknown;
    try {
      posture({ host: "0.0.0.0" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AuthNotConfiguredError);
    const message = (thrown as Error).message;
    expect(message).toContain(SERVE_AUTH_ENV_VARS[0]);
    expect(message).toContain("--allow-anonymous");
    expect(message).toContain("refusing to start");
  });

  test("EXHAUSTIVE: no input combination yields an anonymous plane on an off-box bind", () => {
    const hosts = ["0.0.0.0", "::", "10.0.1.7", "172.16.9.9", "calendar.hasna.xyz"];
    for (const host of hosts) {
      for (const hosted of [true, false]) {
        for (const allowAnonymous of [true, false]) {
          for (const credential of [null, CREDENTIAL]) {
            let resolved: AuthPosture | null = null;
            try {
              resolved = posture({ host, hosted, allowAnonymous, credential });
            } catch (e) {
              expect(e).toBeInstanceOf(AuthNotConfiguredError);
              continue;
            }
            expect(resolved.mode).not.toBe("anonymous-loopback");
          }
        }
      }
    }
  });
});

describe("split-store guard (defect-2 class, behind a credential)", () => {
  test("hosted + serve credential + on-box SQLite local plane REFUSES to start", () => {
    let thrown: unknown;
    try {
      posture({ credential: CREDENTIAL, hosted: true, localPlaneTransport: "local" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SplitStorePlaneError);
    const message = (thrown as Error).message;
    expect(message).toContain("two DIFFERENT datasets");
    expect(message).toContain("HASNA_CALENDAR_API_URL");
    expect(message).not.toContain(CREDENTIAL);
  });

  test("hosted + serve credential is fine when the local plane routes through /v1", () => {
    expect(posture({ credential: CREDENTIAL, hosted: true, localPlaneTransport: "cloud-http" }).mode)
      .toBe("enforce");
  });

  test("a NON-hosted server with a local store is unaffected", () => {
    expect(posture({ credential: CREDENTIAL, hosted: false, localPlaneTransport: "local" }).mode)
      .toBe("enforce");
  });

  test("hosted with NO credential is still local-plane-disabled, not an error", () => {
    expect(posture({ hosted: true, localPlaneTransport: "local" }).mode).toBe("local-plane-disabled");
  });
});

describe("loopback parsing", () => {
  test.each(["127.0.0.1", "127.0.0.53", "127.1.2.3", "::1", "[::1]", "::ffff:127.0.0.1", "localhost"])(
    "%p is loopback",
    (v) => expect(isLoopbackAddress(v)).toBe(true),
  );

  test.each([
    "0.0.0.0",
    "10.0.0.1",
    "::ffff:10.0.0.1",
    "128.0.0.1",
    "1270.0.0.1",
    "127.0.0.1.evil.com",
    "127.0.0.256",
    "127.0.0",
    "",
    undefined,
  ])("%p is NOT loopback", (v) => expect(isLoopbackAddress(v as string | undefined)).toBe(false));

  test("an unset bind host counts as loopback (serve() defaults to 127.0.0.1)", () => {
    expect(isLoopbackHost(undefined)).toBe(true);
    expect(isLoopbackHost("")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });
});

describe("credential handling", () => {
  test("resolveServeCredential reads both env spellings, in priority order", () => {
    expect(resolveServeCredential({})).toBeNull();
    expect(resolveServeCredential({ CALENDAR_SERVE_API_KEY: "a" })).toBe("a");
    expect(resolveServeCredential({ HASNA_CALENDAR_SERVE_API_KEY: "b" })).toBe("b");
    expect(resolveServeCredential({ CALENDAR_SERVE_API_KEY: "a", HASNA_CALENDAR_SERVE_API_KEY: "b" })).toBe("a");
  });

  test("the CLIENT-flip vars are NOT accepted as the serve credential", () => {
    // Reusing them would make the process authenticate callers with the key it
    // uses to call a remote /v1, and would flip getStore() to the ApiStore.
    expect(resolveServeCredential({ HASNA_CALENDAR_API_KEY: "client", CALENDAR_API_KEY: "client" })).toBeNull();
  });

  test("presentedCredential reads x-api-key and Bearer", () => {
    expect(presentedCredential(new Headers({ "x-api-key": "k" }))).toBe("k");
    expect(presentedCredential(new Headers({ authorization: "Bearer k" }))).toBe("k");
    expect(presentedCredential(new Headers({ authorization: "bearer  k " }))).toBe("k");
    expect(presentedCredential(new Headers({ authorization: "Basic k" }))).toBeNull();
    expect(presentedCredential(new Headers())).toBeNull();
  });

  test("timingSafeEqual behaves like equality", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  test("isAnonymousOptInEnv only accepts explicit truthy values", () => {
    expect(isAnonymousOptInEnv({})).toBe(false);
    expect(isAnonymousOptInEnv({ [ALLOW_ANONYMOUS_ENV_VAR]: "0" })).toBe(false);
    expect(isAnonymousOptInEnv({ [ALLOW_ANONYMOUS_ENV_VAR]: "false" })).toBe(false);
    expect(isAnonymousOptInEnv({ [ALLOW_ANONYMOUS_ENV_VAR]: "1" })).toBe(true);
    expect(isAnonymousOptInEnv({ [ALLOW_ANONYMOUS_ENV_VAR]: "TRUE" })).toBe(true);
    expect(isAnonymousOptInEnv({ [ALLOW_ANONYMOUS_ENV_VAR]: "yes" })).toBe(true);
  });
});

describe("authorizeLocalPlane", () => {
  const enforced = posture({ credential: CREDENTIAL });
  const disabled = posture({ hosted: true });
  const anonymous = posture({ allowAnonymous: true, host: "127.0.0.1" });

  test("local-plane-disabled denies everyone with 404, even with a credential", () => {
    const d = authorizeLocalPlane(disabled, new Headers({ "x-api-key": CREDENTIAL }), "127.0.0.1");
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.status).toBe(404);
    expect(d.allow === false && d.body.code).toBe("LOCAL_PLANE_DISABLED");
  });

  test("enforce denies a credential-less request with 401", () => {
    const d = authorizeLocalPlane(enforced, new Headers(), "10.0.1.7");
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.status).toBe(401);
  });

  test("enforce denies a wrong credential", () => {
    expect(authorizeLocalPlane(enforced, new Headers({ "x-api-key": "nope" }), "10.0.1.7").allow).toBe(false);
  });

  test("enforce allows the right credential via either header", () => {
    expect(authorizeLocalPlane(enforced, new Headers({ "x-api-key": CREDENTIAL }), "10.0.1.7").allow).toBe(true);
    expect(
      authorizeLocalPlane(enforced, new Headers({ authorization: `Bearer ${CREDENTIAL}` }), "10.0.1.7").allow,
    ).toBe(true);
  });

  test("anonymous-loopback allows a loopback peer and denies everything else", () => {
    expect(authorizeLocalPlane(anonymous, new Headers(), "127.0.0.1").allow).toBe(true);
    expect(authorizeLocalPlane(anonymous, new Headers(), "::1").allow).toBe(true);
    expect(authorizeLocalPlane(anonymous, new Headers(), "10.0.1.7").allow).toBe(false);
    expect(authorizeLocalPlane(anonymous, new Headers(), undefined).allow).toBe(false);
  });

  test("x-forwarded-for cannot forge a loopback peer", () => {
    const headers = new Headers({
      "x-forwarded-for": "127.0.0.1",
      "x-real-ip": "127.0.0.1",
      forwarded: "for=127.0.0.1",
    });
    // The raw transport peer is what is passed in; headers are never consulted.
    expect(authorizeLocalPlane(anonymous, headers, "10.0.1.7").allow).toBe(false);
  });
});
