import { describe, expect, test } from "bun:test";
import { runIssueKey } from "../src/cli/issue-key";
import type { MintedApiKey } from "../src/auth/keys";

const SIGNING = "synthetic-gateway-issuer-signing-secret-not-a-credential";
const VAULT_KEY = "synthetic-gateway-vault-key-not-a-credential";
const OPTIONS = {
  app: "calendar",
  agent: "gateway-test",
  tid: "test-tenant",
  scopes: "calendar:read",
  issuanceId: "gateway-test-issuance",
  secretsRef: "test/calendar/{agent}/{kid}",
  json: true,
};

function environment(baseUrl: string): NodeJS.ProcessEnv {
  return {
    HASNA_CALENDAR_API_SIGNING_KEY: SIGNING,
    HASNA_CALENDAR_DATABASE_URL: "postgres://unused.example/calendar",
    HASNA_SECRETS_API_URL: baseUrl,
    HASNA_SECRETS_API_KEY: VAULT_KEY,
  };
}

describe("issue-key Secrets gateway authority", () => {
  for (const suffix of ["/secrets", "/secrets/", "/secrets/v1", "/secrets/v1/"]) {
    test(`the real Secrets SDK delivers under ${suffix} without dropping or repeating the prefix`, async () => {
      const requests: Array<{ method: string; path: string }> = [];
      const stored: MintedApiKey[] = [];
      const delivered: Array<{ key: string; value: string; type: string }> = [];
      const reports: unknown[] = [];
      let activations = 0;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url);
          requests.push({ method: request.method, path: url.pathname });
          if (request.headers.get("authorization") !== `Bearer ${VAULT_KEY}`) {
            return new Response("unexpected credential", { status: 401 });
          }
          if (request.method !== "POST" || url.pathname !== "/secrets/v1/secrets") {
            return new Response("unexpected route", { status: 404 });
          }
          const input = await request.json() as { key: string; value: string; type: string };
          delivered.push(input);
          return Response.json({
            key: input.key,
            type: input.type,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          });
        },
      });
      const originalLog = console.log;
      const output: string[] = [];
      console.log = (...args: unknown[]) => void output.push(args.map(String).join(" "));
      try {
        const origin = `http://127.0.0.1:${server.port}`;
        await runIssueKey(OPTIONS, {
          env: {
            ...environment(`${origin}${suffix}`),
            // These spelling variants must resolve to one SDK authority.
            SECRETS_API_URL: `${origin}/secrets/v1/`,
            SECRETS_API_KEY: VAULT_KEY,
          },
          report: (_options, error, details) => void reports.push({ error, details }),
          connectStore: async () => ({
            store: {
              ensureSchema: async () => {},
              findByKid: async () => null,
              insertMinted: async () => { throw new Error("active insert must not run"); },
              insertMintedPending: async minted => void stored.push(minted),
              activatePending: async () => { activations += 1; return true; },
              revoke: async () => true,
            },
            close: async () => {},
          }),
          // Deliberately no connectSecrets mock: load the actual published SDK.
        });
      } finally {
        console.log = originalLog;
        server.stop(true);
      }
      expect(reports).toEqual([]);
      expect(requests).toEqual([{ method: "POST", path: "/secrets/v1/secrets" }]);
      expect(stored).toHaveLength(1);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.key).toBe("test/calendar/gateway-test/gateway-test-issuance");
      expect(delivered[0]?.value).toBe(stored[0]?.token);
      expect(activations).toBe(1);
      expect(JSON.parse(output.join("\n"))).toMatchObject({ ok: true, tid: "test-tenant", vaultStored: true });
      expect(output.join("\n")).not.toContain(stored[0]!.token);
      expect(output.join("\n")).not.toContain(stored[0]!.tokenHash);
      expect(output.join("\n")).not.toContain(VAULT_KEY);
    });
  }

  const rejected = [
    { base: "https://api.example.test/secrets?", code: "invalid_secrets_config" },
    { base: "https://api.example.test/secrets#", code: "invalid_secrets_config" },
    { base: "https://api.example.test/secrets?query=1", code: "invalid_secrets_config" },
    { base: "https://api.example.test/secrets#fragment", code: "invalid_secrets_config" },
    { base: "https://user:password@api.example.test/secrets", code: "invalid_secrets_config" },
    { base: "http://api.example.test/secrets", code: "invalid_secrets_config" },
    { base: "https://api.example.test/secret\ns", code: "invalid_secrets_config" },
    { base: "https://api.example.test/secrets", alias: "https://api.example.test/other/v1", code: "conflicting_secrets_config" },
  ];
  for (const { base, alias, code } of rejected) {
    test(`rejects an unsafe or conflicting authority before issuance: ${JSON.stringify(base)} ${alias ?? ""}`, async () => {
      let mintCalls = 0;
      let databaseCalls = 0;
      let vaultCalls = 0;
      const reports: Array<{ error: string; details?: Record<string, unknown> }> = [];
      await runIssueKey(OPTIONS, {
        env: {
          ...environment(base),
          ...(alias ? { SECRETS_API_URL: alias, SECRETS_API_KEY: VAULT_KEY } : {}),
        },
        now: () => { mintCalls += 1; return Date.now(); },
        connectStore: async () => { databaseCalls += 1; throw new Error("must not connect"); },
        connectSecrets: async () => { vaultCalls += 1; throw new Error("must not connect"); },
        report: (_options, error, details) => void reports.push({ error, ...(details ? { details } : {}) }),
      });
      expect(reports).toHaveLength(1);
      expect(reports[0]?.details).toEqual({ code });
      expect({ mintCalls, databaseCalls, vaultCalls }).toEqual({ mintCalls: 0, databaseCalls: 0, vaultCalls: 0 });
      expect(JSON.stringify(reports)).not.toContain(VAULT_KEY);
      expect(JSON.stringify(reports)).not.toContain(base);
    });
  }
});
