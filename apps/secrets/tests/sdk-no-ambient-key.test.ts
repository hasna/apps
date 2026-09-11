// SDK credential-pinning contract (hasna/apps#1794, validated under #1720).
//
// `createSecretsClientFromEnv` with an EXPLICIT `baseUrl` and NO explicit
// `apiKey` must NOT attach the ambient fleet credential — the machine's Keychain
// item, the credentials file, or HASNA_SECRETS_API_KEY — to that caller-supplied
// authority. Before this fix it ran the full resolver and handed the resolved key
// (measured: the live Keychain key, as `Authorization` + `x-api-key`) to a client
// bound to a foreign origin. The credential is pinned to the authority it
// resolved with; a caller who names an authority has to name the key too.
//
// The rule is enforced BEFORE any resolver tier runs: no Keychain read, no disk
// read, and — proven here with a loopback server — no request at all.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createSecretsClientFromEnv } from "../src/sdk.js";
import { SecretsClient } from "../src/sdk.js";
import type { KeychainCommandRunner } from "../src/store/client.js";

const AMBIENT_KEY = "hasna_secrets_ambient_key_must_not_leak_0001";
const PINNED_KEY = "hasna_secrets_caller_pinned_key_0002";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
const received: Array<{ path: string; authorization: string | null; apiKey: string | null }> = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      received.push({
        path: url.pathname,
        authorization: req.headers.get("authorization"),
        apiKey: req.headers.get("x-api-key"),
      });
      return Response.json({ secrets: [] });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

const previousAmbient = process.env.HASNA_SECRETS_API_KEY;
afterEach(() => {
  received.length = 0;
  if (previousAmbient === undefined) delete process.env.HASNA_SECRETS_API_KEY;
  else process.env.HASNA_SECRETS_API_KEY = previousAmbient;
});

describe("createSecretsClientFromEnv with an explicit baseUrl (#1794)", () => {
  it("refuses to build a client for a caller-supplied authority without a caller-supplied key", async () => {
    // The LIVE process environment carries an ambient key on purpose: a factory
    // that wrongly consulted the resolver would find it (tier 5) and attach it.
    process.env.HASNA_SECRETS_API_KEY = AMBIENT_KEY;

    expect(() => createSecretsClientFromEnv(process.env, { baseUrl })).toThrow(
      /explicit baseUrl requires an explicit apiKey/,
    );
    expect(() => createSecretsClientFromEnv(process.env, { baseUrl, apiKey: "" })).toThrow(
      /explicit baseUrl requires an explicit apiKey/,
    );
    // Nothing reached the authority: not a probe, not an authenticated call.
    expect(received).toEqual([]);
  });

  it("consults NO resolver tier on the way to the refusal — the Keychain runner is never invoked", () => {
    process.env.HASNA_SECRETS_API_KEY = AMBIENT_KEY;
    let keychainCalls = 0;
    const run: KeychainCommandRunner = () => {
      keychainCalls += 1;
      return { status: 0, stdout: `${AMBIENT_KEY}\n`, stderr: "" };
    };

    expect(() =>
      createSecretsClientFromEnv(process.env, { baseUrl, credentials: { keychain: { run } } }),
    ).toThrow(/#1794/);
    expect(keychainCalls).toBe(0);
    expect(received).toEqual([]);
  });

  it("an explicit baseUrl WITH an explicit apiKey sends exactly that key, never the ambient one", async () => {
    process.env.HASNA_SECRETS_API_KEY = AMBIENT_KEY;

    const client = createSecretsClientFromEnv(process.env, { baseUrl, apiKey: PINNED_KEY });
    await client.listSecrets();

    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe("/v1/secrets");
    expect(received[0]!.apiKey).toBe(PINNED_KEY);
    expect(received[0]!.authorization).toBe(`Bearer ${PINNED_KEY}`);
    expect(JSON.stringify(received)).not.toContain(AMBIENT_KEY);
  });

  it("the tier-1 `credentials.apiKey` argument counts as a caller-pinned key too", async () => {
    process.env.HASNA_SECRETS_API_KEY = AMBIENT_KEY;

    const client = createSecretsClientFromEnv(process.env, { baseUrl, credentials: { apiKey: PINNED_KEY } });
    await client.listSecrets();

    expect(received).toHaveLength(1);
    expect(received[0]!.apiKey).toBe(PINNED_KEY);
    expect(JSON.stringify(received)).not.toContain(AMBIENT_KEY);
  });

  it("without a baseUrl the resolver chain still applies (tier 5 here) and pins the resolved authority", async () => {
    // The positive control for the rule above: the SAME ambient key IS used when
    // the authority ALSO comes from the chain — key and URL travel together.
    const client = createSecretsClientFromEnv({
      HASNA_SECRETS_API_URL: baseUrl,
      HASNA_SECRETS_API_KEY: AMBIENT_KEY,
    });
    await client.listSecrets();

    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe("/v1/secrets");
    expect(received[0]!.apiKey).toBe(AMBIENT_KEY);
  });
});

describe("SecretsClient direct construction (#1720 adversarial credential-seam audit)", () => {
  it("an explicit baseUrl with NO apiKey REFUSES loudly — never an unauthenticated transport", () => {
    // The direct client carries ONLY what the caller hands it; the ambient
    // chain (Keychain, credentials file, HASNA_SECRETS_API_KEY) is a factory
    // concern and is never consulted here. `apiKey: ""` must refuse exactly
    // like an absent key — a blank key built the same unauthenticated
    // transport before this fix (`options.apiKey ?? ""`).
    process.env.HASNA_SECRETS_API_KEY = AMBIENT_KEY;
    const message = /SECRETS_CLIENT_PIN_REQUIRED: a SecretsClient with an explicit baseUrl requires an explicit apiKey/;
    expect(() => new SecretsClient({ baseUrl })).toThrow(message);
    expect(() => new SecretsClient({ baseUrl, apiKey: "" })).toThrow(message);
    // The refusal names the expected env sources and carries no key VALUE.
    const text = (() => {
      try {
        new SecretsClient({ baseUrl });
      } catch (error) {
        return String((error as Error).message);
      }
      return "";
    })();
    expect(text).toContain("HASNA_SECRETS_API_URL");
    expect(text).toContain("HASNA_SECRETS_API_KEY");
    expect(text).not.toContain(AMBIENT_KEY);
    // Nothing reached the authority — not a probe, not a request.
    expect(received).toEqual([]);
  });

  it("a baseUrl WITH an apiKey still constructs and authenticates exactly that key", async () => {
    const client = new SecretsClient({ baseUrl, apiKey: PINNED_KEY });
    await client.listSecrets();
    expect(received).toHaveLength(1);
    expect(received[0]!.apiKey).toBe(PINNED_KEY);
    expect(received[0]!.authorization).toBe(`Bearer ${PINNED_KEY}`);
    expect(JSON.stringify(received)).not.toContain(AMBIENT_KEY);
  });

  it("a baseUrl with a CredentialProvider is a per-request credential, not a refusal", async () => {
    const client = new SecretsClient({
      baseUrl,
      apiKey: () => ({
        apiKey: PINNED_KEY,
        tier: "argument" as const,
        source: "test",
        deliberate: true,
        diskCandidates: [],
        warning: null,
      }),
    });
    await client.listSecrets();
    expect(received).toHaveLength(1);
    expect(received[0]!.apiKey).toBe(PINNED_KEY);
  });
});
