/**
 * Transport resolution tests for the ./sdk client surface — the shared
 * @hasna/contracts resolver behind it (hasna/apps#1720).
 *
 * Contract (owner ruling 2026-09-04, fleet storage doctrine): a hosted run
 * NEEDS a credential — the loose old pair (`HASNA_MESSAGES_API_URL` alone
 * selected an unauthenticated http transport) is gone. A configured authority
 * with no resolvable key THROWS; nothing configured and no explicit local
 * opt-in THROWS; the on-box SQLite store is reachable ONLY under the explicit
 * `HASNA_MESSAGES_LOCAL=1` opt-in. An explicit `baseUrl` pins the authority —
 * and with it the credential (#1794): no ambient fleet key is ever attached
 * to a caller-chosen authority. All cases inject caller-built env records with
 * no HOME, so the disk tier is absent and (on this non-darwin runner) so is
 * the Keychain tier — nothing here reads or mutates the real process env.
 */
import { describe, expect, test } from "bun:test";
import {
  MESSAGES_API_KEY_ENV,
  MESSAGES_API_URL_ENV,
  MESSAGES_LOCAL_OPT_IN_ENV_KEYS,
  MESSAGES_DEFAULT_API_URL,
  createMessagesClient,
  isMessagesLocalOptIn,
  resolveMessagesClientTransport,
} from "./index.js";

function envWith(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    [MESSAGES_API_URL_ENV]: undefined,
    [MESSAGES_API_KEY_ENV]: undefined,
    ...overrides,
  };
}

describe("resolveMessagesClientTransport — STRICT pair through the shared resolver", () => {
  test("URL + key resolves http at the configured authority with its /v1 root", () => {
    const report = resolveMessagesClientTransport(
      envWith({ [MESSAGES_API_URL_ENV]: "https://messages.example.com/base", [MESSAGES_API_KEY_ENV]: "k" }),
    );
    expect(report.transport).toBe("http");
    expect(report.baseUrl).toBe("https://messages.example.com/base/v1");
    expect(report.apiUrlPresent).toBe(true);
    expect(report.apiUrlSource).toBe(MESSAGES_API_URL_ENV);
    expect(report.apiKeyPresent).toBe(true);
    expect(report.apiKeyTier).toBe("env");
    expect(report.authorityPinned).toBe(false);
    expect(JSON.stringify(report)).not.toContain("k");
  });

  test("a key alone resolves http at the fleet gateway default", () => {
    // The old chain refused this as a half-configured pair; the resolver's
    // documented rule is that a key from any tier reaches the fleet.
    const report = resolveMessagesClientTransport(envWith({ [MESSAGES_API_KEY_ENV]: "k1" }));
    expect(report.transport).toBe("http");
    expect(report.baseUrl).toBe(`${MESSAGES_DEFAULT_API_URL}/v1`);
    expect(report.apiUrlSource).toBe("default");
    expect(report.configuredApiBase).toBeNull();
    expect(report.apiKeyTier).toBe("env");
  });

  test("URL present WITHOUT a resolvable key is a hard error (the old loose pair is gone)", () => {
    expect(() => resolveMessagesClientTransport(envWith({ [MESSAGES_API_URL_ENV]: "https://messages.example.com" })))
      .toThrow(/HASNA_MESSAGES_API_URL.*no API key could be resolved/);
  });

  test("no URL, no key, no opt-in THROWS an error naming the env and the opt-in", () => {
    const error = (): unknown => {
      try {
        resolveMessagesClientTransport(envWith({}));
      } catch (e) {
        return e;
      }
      return null;
    };
    expect(() => resolveMessagesClientTransport(envWith({}))).toThrow(/HASNA_MESSAGES_API_URL/);
    expect(() => resolveMessagesClientTransport(envWith({}))).toThrow(/HASNA_MESSAGES_LOCAL=1/);
    expect(error()).toBeInstanceOf(Error);
  });

  test("an API key alone never selects a transport without the resolver — it resolves the gateway", () => {
    const report = resolveMessagesClientTransport(envWith({ [MESSAGES_API_KEY_ENV]: "k" }));
    expect(report.transport).toBe("http");
    expect(report.apiKeyPresent).toBe(true);
  });
});

describe("the explicit local opt-in", () => {
  test("HASNA_MESSAGES_LOCAL=1 selects the on-box store when nothing configures an authority", () => {
    const report = resolveMessagesClientTransport(envWith({ HASNA_MESSAGES_LOCAL: "1" }));
    expect(report.transport).toBe("local");
    expect(report.localOptIn).toBe(true);
    expect(report.baseUrl).toBeNull();
    expect(report.apiUrlPresent).toBe(false);
    expect(report.apiKeyPresent).toBe(false);
  });

  test("the MESSAGES_LOCAL alias works too", () => {
    expect(isMessagesLocalOptIn(envWith({ MESSAGES_LOCAL: "1" }))).toBe(true);
    const report = resolveMessagesClientTransport(envWith({ MESSAGES_LOCAL: "1" }));
    expect(report.transport).toBe("local");
  });

  test("falsy opt-in values (0, false, no, off, blank) do not open local mode", () => {
    for (const value of ["0", "false", "no", "off", ""]) {
      expect(isMessagesLocalOptIn(envWith({ HASNA_MESSAGES_LOCAL: value }))).toBe(false);
      expect(() => resolveMessagesClientTransport(envWith({ HASNA_MESSAGES_LOCAL: value }))).toThrow(
        /HASNA_MESSAGES_API_URL/,
      );
    }
  });

  test("truthy spellings of the opt-in open local mode", () => {
    for (const value of ["1", "true", "yes", " 1 "]) {
      expect(isMessagesLocalOptIn(envWith({ HASNA_MESSAGES_LOCAL: value }))).toBe(true);
    }
  });

  test("a configured environment outranks the opt-in", () => {
    const report = resolveMessagesClientTransport(
      envWith({ HASNA_MESSAGES_LOCAL: "1", [MESSAGES_API_KEY_ENV]: "k" }),
    );
    expect(report.transport).toBe("http");
    expect(report.apiKeyTier).toBe("env");
  });

  test("declared-but-blank variables count as unset for the opt-in decision", () => {
    // A scrubbed wrapper leaves blanks; blank means "not configured" at the
    // messages seam, so the opt-in still applies.
    const report = resolveMessagesClientTransport(
      envWith({ HASNA_MESSAGES_LOCAL: "1", [MESSAGES_API_URL_ENV]: "", [MESSAGES_API_KEY_ENV]: " " }),
    );
    expect(report.transport).toBe("local");
  });

  test("the local opt-in keys are exported for operators to grep for", () => {
    expect(MESSAGES_LOCAL_OPT_IN_ENV_KEYS).toEqual(["HASNA_MESSAGES_LOCAL", "MESSAGES_LOCAL"]);
  });
});

describe("an explicit baseUrl pins the authority AND the credential (#1794)", () => {
  test("pinned baseUrl without apiKey attaches NO ambient credential", () => {
    // The ambient chain holds a key; the pinned authority must never see it.
    const env = envWith({ [MESSAGES_API_KEY_ENV]: "ambient-fleet-key" });
    const report = resolveMessagesClientTransport(env, { baseUrl: "https://pinned.example.com" });
    expect(report.transport).toBe("http");
    expect(report.authorityPinned).toBe(true);
    expect(report.apiKeyPresent).toBe(false);
    expect(report.apiKeySource).toBeNull();
    expect(report.baseUrl).toBe("https://pinned.example.com/v1");
  });

  test("pinned baseUrl with an explicit apiKey uses exactly that key", () => {
    const report = resolveMessagesClientTransport(envWith({ [MESSAGES_API_KEY_ENV]: "ambient" }), {
      baseUrl: "https://pinned.example.com",
      apiKey: "explicit-pin",
    });
    expect(report.transport).toBe("http");
    expect(report.authorityPinned).toBe(true);
    expect(report.apiKeyPresent).toBe(true);
    expect(report.apiKeyTier).toBe("argument");
  });

  test("createMessagesClient sends NO x-api-key for a pinned baseUrl, despite an ambient key", async () => {
    const sent: Array<{ url: string; key: string | null }> = [];
    const client = createMessagesClient(envWith({ [MESSAGES_API_KEY_ENV]: "ambient-fleet-key" }), {
      baseUrl: "https://pinned.example.com",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        sent.push({
          url: String(input),
          key: ((init?.headers as Record<string, string> | undefined) ?? {})["x-api-key"] ?? null,
        });
        return new Response(JSON.stringify({ agents: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    expect(client).not.toBeNull();
    await client!.listAgents();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://pinned.example.com/v1/agents");
    expect(sent[0]!.key).toBeNull();
  });

  test("createMessagesClient with pinned baseUrl + apiKey sends that key", async () => {
    const sent: Array<{ key: string | null }> = [];
    const client = createMessagesClient(envWith({ [MESSAGES_API_KEY_ENV]: "ambient" }), {
      baseUrl: "https://pinned.example.com",
      apiKey: "pinned-key",
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        sent.push({ key: ((init?.headers as Record<string, string> | undefined) ?? {})["x-api-key"] ?? null });
        return new Response(JSON.stringify({ agents: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    await client!.listAgents();
    expect(sent[0]!.key).toBe("pinned-key");
  });
});

describe("createMessagesClient follows the same gate", () => {
  test("URL + key env -> client; opt-in local -> null; neither -> throw", () => {
    const client = createMessagesClient(
      envWith({ [MESSAGES_API_URL_ENV]: "https://messages.example.com/", [MESSAGES_API_KEY_ENV]: "k" }),
    );
    expect(client).not.toBeNull();
    expect(createMessagesClient(envWith({ HASNA_MESSAGES_LOCAL: "1" }))).toBeNull();
    expect(() => createMessagesClient(envWith({}))).toThrow(/HASNA_MESSAGES_API_URL/);
  });

  test("the client re-resolves the credential per request, so a rotation heals mid-flight", async () => {
    const env = envWith({ [MESSAGES_API_URL_ENV]: "https://messages.example.com", [MESSAGES_API_KEY_ENV]: "key-one" });
    const sent: string[] = [];
    const client = createMessagesClient(env, {
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        sent.push(((init?.headers as Record<string, string> | undefined) ?? {})["x-api-key"] ?? "");
        return new Response(JSON.stringify({ agents: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    expect(client).not.toBeNull();
    await client!.listAgents();
    // Rotate the credential the chain reads; the next request picks it up.
    env[MESSAGES_API_KEY_ENV] = "key-two";
    await client!.listAgents();
    expect(sent).toEqual(["key-one", "key-two"]);
  });
});