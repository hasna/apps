import { afterEach, describe, expect, test } from "bun:test";
import { closeCloud, getCloudVerifier } from "./cloud.js";
import { handleV1Request } from "./v1.js";

/**
 * REGRESSION FENCE for the `/v1` auth wiring.
 *
 * `getCloudVerifier()` used to build the contracts verifier with
 * `isRevoked: store.isRevoked`. That predicate returns `false` BOTH for an
 * active key and for a kid this service has no record of, so an authentically
 * signed token that was never registered authenticated — and could never be
 * revoked, because revocation writes `revoked_at` to a row that does not
 * exist.
 *
 * `@hasna/contracts` now refuses that wiring at CONSTRUCTION time. The throw
 * surfaced through `handleV1Request`'s verifier-construction catch, so every
 * `/v1` route in the hosted posture answered **503 with the contracts
 * configuration message** instead of authenticating — anonymous callers
 * included. Two defects in one: `/v1` was wholly unavailable, and an anonymous
 * request was handed internal auth-configuration text.
 *
 * The fix wires the strict hook, `keyStatus: store.keyStatus`, which reports
 * `unknown` for an unregistered kid and therefore denies it.
 *
 * Against the pre-fix source these tests fail: construction throws, and the
 * thrown message names `isRevoked`.
 */

const DUMMY_DSN = "postgres://calendar_app@127.0.0.1:1/calendar_test?sslmode=verify-full";
const DUMMY_SIGNING_SECRET = "signing-secret-for-tests-only";

const HOSTED_VARS = [
  "HASNA_CALENDAR_DATABASE_URL",
  "CALENDAR_DATABASE_URL",
  "DATABASE_URL",
  "HASNA_CALENDAR_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
  "API_KEY_SIGNING_SECRET",
] as const;

function applyHostedEnv(env: Record<string, string>) {
  for (const key of HOSTED_VARS) delete process.env[key];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

afterEach(async () => {
  await closeCloud();
  for (const key of HOSTED_VARS) delete process.env[key];
});

describe("getCloudVerifier: the /v1 verifier is wired with a strict key-status hook", () => {
  test("it constructs in the hosted posture instead of throwing on its own wiring", () => {
    applyHostedEnv({
      HASNA_CALENDAR_DATABASE_URL: DUMMY_DSN,
      HASNA_CALENDAR_API_SIGNING_KEY: DUMMY_SIGNING_SECRET,
    });
    // Pre-fix this threw the contracts guard: "verifyApiKey was given only
    // 'isRevoked', which cannot refuse a key this service has no record of".
    const verifier = getCloudVerifier();
    expect(verifier.app).toBe("calendar");
    expect(typeof verifier.authenticate).toBe("function");
  });

  test("an anonymous request is denied 401 without dialling the database", async () => {
    applyHostedEnv({
      HASNA_CALENDAR_DATABASE_URL: DUMMY_DSN,
      HASNA_CALENDAR_API_SIGNING_KEY: DUMMY_SIGNING_SECRET,
    });
    const decision = await getCloudVerifier().authenticate(new Headers(), {
      method: "GET",
      path: "/v1/orgs",
      requiredScopes: ["calendar:read"],
    });
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
    // The DSN is deliberately dead. A 503 here would mean the key-status
    // lookup ran before the missing-credential check.
    expect(JSON.stringify(decision)).not.toContain("postgres://");
    expect(JSON.stringify(decision)).not.toContain(DUMMY_SIGNING_SECRET);
  });

  test("a bogus token is refused on its signature, not on a store lookup", async () => {
    applyHostedEnv({
      HASNA_CALENDAR_DATABASE_URL: DUMMY_DSN,
      HASNA_CALENDAR_API_SIGNING_KEY: DUMMY_SIGNING_SECRET,
    });
    const decision = await getCloudVerifier().authenticate(
      new Headers({ "x-api-key": "hasna_calendar_not-a-real-body.not-a-real-signature" }),
      { method: "GET", path: "/v1/orgs", requiredScopes: ["calendar:read"] },
    );
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("it still fails closed when no signing secret is configured", () => {
    applyHostedEnv({ HASNA_CALENDAR_DATABASE_URL: DUMMY_DSN });
    expect(() => getCloudVerifier()).toThrow(/signing secret/i);
  });
});

describe("a verifier-construction failure does not describe itself to the caller", () => {
  /**
   * The blast radius of the wiring defect above was this branch: `/v1` returned
   * the construction error VERBATIM to an unauthenticated caller. Now the
   * detail goes to the process log and the response is a bare 503.
   */
  const CONFIG_DETAIL =
    "Calendar /v1 auth requires a signing secret (HASNA_CALENDAR_API_SIGNING_KEY / ...)";

  async function requestWithBrokenVerifier(): Promise<{ status: number; text: string; logged: string[] }> {
    const logged: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    try {
      const request = new Request("https://calendar.test/v1/orgs");
      const response = (await handleV1Request(request, new URL(request.url), {
        getCloudVerifier: () => {
          throw new Error(CONFIG_DETAIL);
        },
        getCloudStore: (() => {
          throw new Error("the store must never be reached on an auth failure");
        }) as never,
      }))!;
      return { status: response.status, text: await response.text(), logged };
    } finally {
      console.error = realError;
    }
  }

  test("the response is a bare 503 carrying no configuration detail", async () => {
    const { status, text } = await requestWithBrokenVerifier();
    expect(status).toBe(503);
    expect(JSON.parse(text)).toEqual({ error: "service unavailable" });
    for (const fragment of ["signing secret", "HASNA_CALENDAR_API_SIGNING_KEY", "isRevoked", "keyStatus"]) {
      expect(text).not.toContain(fragment);
    }
  });

  test("the operator still gets the detail on the process log", async () => {
    const { logged } = await requestWithBrokenVerifier();
    // Positive control: the suppression above is real suppression, not a
    // silently swallowed error.
    expect(logged.join("\n")).toContain(CONFIG_DETAIL);
  });
});
