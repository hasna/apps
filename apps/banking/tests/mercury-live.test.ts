import { describe, expect, test } from "bun:test";
import {
  MercuryApiError,
  MercuryCredentialError,
  createMercuryReadClient,
  resolveMercuryApiKey,
} from "../src/providers/mercury-live.ts";

describe("Mercury live read adapter", () => {
  test("resolves credentials from env before secrets CLI", () => {
    expect(resolveMercuryApiKey({
      environment: "production",
      env: { MERCURY_API_KEY: " env-token " },
      readSecret: () => {
        throw new Error("should not call secrets");
      },
    })).toBe("env-token");
  });

  test("resolves credentials from explicit secret key", () => {
    expect(resolveMercuryApiKey({
      environment: "production",
      secretKey: "fixture-secret-key",
      env: {},
      readSecret: (key) => key === "fixture-secret-key" ? "secret-token" : undefined,
    })).toBe("secret-token");
  });

  test("throws a credential error when no credential source resolves", () => {
    expect(() => resolveMercuryApiKey({
      environment: "production",
      env: {},
      readSecret: () => undefined,
    })).toThrow(MercuryCredentialError);
  });

  test("lists accounts through the production API and redacts full routing details", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url, init) => {
        expect(String(url)).toBe("https://api.mercury.com/api/v1/accounts?limit=2");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
        return jsonResponse({
          accounts: [{
            id: "acct_1",
            name: "Operating",
            kind: "checking",
            accountNumber: "masked-account-7890",
            routingNumber: "masked-routing-0021",
            currentBalance: "100.00",
            availableBalance: "90.00",
          }],
        });
      },
    });

    const accounts = await client.listAccounts({ limit: 2 });
    expect(accounts).toEqual([{
      id: "acct_1",
      name: "Operating",
      kind: "checking",
      currentBalance: "100.00",
      availableBalance: "90.00",
      accountNumberLast4: "7890",
      routingNumberLast4: "0021",
    }]);
  });

  test("gets balance through the Mercury account endpoint", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        expect(String(url)).toBe("https://api.mercury.com/api/v1/account/acct_1");
        return jsonResponse({
          id: "acct_1",
          currentBalance: "100.00",
          availableBalance: "90.00",
          status: "active",
        });
      },
    });

    await expect(client.getBalance({ accountId: "acct_1" })).resolves.toEqual({
      accountId: "acct_1",
      currentBalance: "100.00",
      availableBalance: "90.00",
      status: "active",
    });
  });

  test("lists organization-wide cards through the current read-only endpoint", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        expect(String(url)).toBe("https://api.mercury.com/api/v1/cards?limit=2");
        return jsonResponse({
          cards: [{ id: "card_1", accountId: "acct_1", lastFour: "4242", status: "active", type: "virtual", kind: "credit" }],
          page: {},
        });
      },
    });

    await expect(client.listCards({ limit: 2 })).resolves.toEqual([
      { id: "card_1", accountId: "acct_1", lastFour: "4242", status: "active", type: "virtual", kind: "credit" },
    ]);
  });

  test("filters cards by account when requested", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        expect(String(url)).toBe("https://api.mercury.com/api/v1/cards?accountId=acct_1&limit=1");
        return jsonResponse({ cards: [{ cardId: "card_1", accountId: "acct_1", lastFourDigits: "4242", status: "active" }] });
      },
    });

    await expect(client.listCards({ accountId: "acct_1", limit: 1 })).resolves.toEqual([
      { id: "card_1", accountId: "acct_1", lastFour: "4242", status: "active" },
    ]);
  });

  test("lists transactions through account-scoped read-only endpoint", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        expect(String(url)).toBe("https://api.mercury.com/api/v1/account/acct_1/transactions?limit=1");
        return jsonResponse({ transactions: [{ id: "txn_1", amount: "1.00", status: "posted" }] });
      },
    });

    await expect(client.listTransactions({ accountId: "acct_1", limit: 1 })).resolves.toEqual([
      { id: "txn_1", amount: "1.00", status: "posted" },
    ]);
  });

  test("rejects unsupported limits instead of silently clamping", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async () => {
        throw new Error("should not call Mercury with an invalid limit");
      },
    });

    await expect(client.listAccounts({ limit: 1001 })).rejects.toThrow("Mercury limit must be between 1 and 1000.");
    await expect(client.listCards({ limit: 1001 })).rejects.toThrow("Mercury limit must be between 1 and 1000.");
  });

  test("fails closed when list responses do not include the expected array", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async () => jsonResponse({ page: {} }),
    });

    await expect(client.listTransactions({ accountId: "acct_1" })).rejects.toThrow("Mercury response is missing transactions.");
  });

  test("fails closed when list entries are malformed", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async () => jsonResponse({ accounts: ["not-an-account"] }),
    });

    await expect(client.listAccounts()).rejects.toThrow("Mercury accounts response item 0 was not an object.");
  });

  test("fails closed when required balance or transaction fields are missing", async () => {
    const balanceClient = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async () => jsonResponse({ id: "acct_1", currentBalance: "100.00" }),
    });
    await expect(balanceClient.getBalance({ accountId: "acct_1" })).rejects.toThrow("Mercury response is missing required availableBalance.");

    const transactionClient = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async () => jsonResponse({ transactions: [{ id: "txn_1", status: "sent" }] }),
    });
    await expect(transactionClient.listTransactions({ accountId: "acct_1" })).rejects.toThrow("Mercury response is missing required amount.");
  });

  test("redacts HTTP response bodies from errors", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async () => new Response(JSON.stringify({ token: "do-not-leak" }), { status: 401 }),
    });

    try {
      await client.listAccounts();
      throw new Error("expected listAccounts to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MercuryApiError);
      expect(String(error)).not.toContain("do-not-leak");
    }
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
