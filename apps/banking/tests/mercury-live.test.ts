import { describe, expect, test } from "bun:test";
import {
  assertMercuryLiveConformance,
  runMercuryLiveReadSmoke,
} from "../src/providers/mercury-conformance.ts";
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

  test("prefers environment-specific credentials over the generic alias", () => {
    expect(resolveMercuryApiKey({
      environment: "production",
      env: {
        MERCURY_API_KEY: "generic-token",
        MERCURY_PRODUCTION_API_KEY: "production-token",
      },
    })).toBe("production-token");
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

  test("lists accounts with documented cursor pagination parameters", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        expect(String(url)).toBe("https://api.mercury.com/api/v1/accounts?limit=3&order=desc&start_after=acct_prev");
        return jsonResponse({ accounts: [{ id: "acct_1" }] });
      },
    });

    await expect(client.listAccounts({ limit: 3, order: "desc", startAfter: "acct_prev" })).resolves.toEqual([{ id: "acct_1" }]);
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

  test("lists cards with documented cursor pagination parameters", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        expect(String(url)).toBe("https://api.mercury.com/api/v1/cards?limit=2&order=desc&end_before=card_next");
        return jsonResponse({ cards: [{ id: "card_1", status: "active" }] });
      },
    });

    await expect(client.listCards({ limit: 2, order: "desc", endBefore: "card_next" })).resolves.toEqual([
      { id: "card_1", status: "active" },
    ]);
  });

  test("lists organization-wide transactions through the current read-only endpoint", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        expect(String(url)).toBe("https://api.mercury.com/api/v1/transactions?limit=1&order=desc");
        return jsonResponse({ transactions: [{ id: "txn_1", accountId: "acct_1", amount: "1.00", status: "posted" }] });
      },
    });

    await expect(client.listTransactions({ limit: 1, order: "desc" })).resolves.toEqual([
      { id: "txn_1", accountId: "acct_1", amount: "1.00", status: "posted" },
    ]);
  });

  test("lists transactions with documented cursor pagination parameters", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        expect(String(url)).toBe("https://api.mercury.com/api/v1/transactions?limit=2&order=asc&start_at=txn_0");
        return jsonResponse({ transactions: [{ id: "txn_1", amount: "1.00", status: "posted" }] });
      },
    });

    await expect(client.listTransactions({ limit: 2, order: "asc", startAt: "txn_0" })).resolves.toEqual([
      { id: "txn_1", amount: "1.00", status: "posted" },
    ]);
  });

  test("filters transactions by account when requested", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        expect(String(url)).toBe("https://api.mercury.com/api/v1/transactions?accountId=acct_1&limit=1");
        return jsonResponse({ transactions: [{ id: "txn_1", accountId: "acct_1", amount: "1.00", status: "posted" }] });
      },
    });

    await expect(client.listTransactions({ accountId: "acct_1", limit: 1 })).resolves.toEqual([
      { id: "txn_1", accountId: "acct_1", amount: "1.00", status: "posted" },
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
    await expect(client.listTransactions({ limit: 1001 })).rejects.toThrow("Mercury limit must be between 1 and 1000.");
    await expect(client.listTransactions({ order: "newest" as "desc" })).rejects.toThrow("Mercury order must be asc or desc.");
  });

  test("rejects conflicting cursor pagination before calling Mercury", async () => {
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async () => {
        throw new Error("should not call Mercury with invalid pagination");
      },
    });

    await expect(client.listAccounts({ startAfter: "acct_1", endBefore: "acct_2" })).rejects.toThrow(
      "Mercury cursor pagination accepts only one of startAfter, endBefore, or startAt.",
    );
    await expect(client.listAccounts({ startAt: "acct_1" } as never)).rejects.toThrow(
      "Mercury startAt pagination is only supported for transaction lists.",
    );
    await expect(client.listCards({ startAfter: "card_1", endBefore: "card_2" })).rejects.toThrow(
      "Mercury cursor pagination accepts only one of startAfter, endBefore, or startAt.",
    );
    await expect(client.listTransactions({ startAfter: "txn_1", startAt: "txn_2" })).rejects.toThrow(
      "Mercury cursor pagination accepts only one of startAfter, endBefore, or startAt.",
    );
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

  test("redacts fetch and malformed JSON failures", async () => {
    const fetchFailureClient = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async () => {
        throw new Error("network failed for acct_secret");
      },
    });
    try {
      await fetchFailureClient.listAccounts();
      throw new Error("expected fetch failure");
    } catch (error) {
      expect(String(error)).toContain("Mercury API request failed before receiving a response.");
      expect(String(error)).not.toContain("acct_secret");
    }

    const malformedJsonClient = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async () => new Response("{\"accounts\":[{\"id\":\"acct_secret\"}"),
    });
    try {
      await malformedJsonClient.listAccounts();
      throw new Error("expected malformed JSON failure");
    } catch (error) {
      expect(String(error)).toContain("Mercury API response was not valid JSON.");
      expect(String(error)).not.toContain("acct_secret");
    }
  });

  test("Mercury live conformance pins the exact read-only live operation set", () => {
    const report = assertMercuryLiveConformance();

    expect(report).toMatchObject({
      providerId: "mercury",
      status: "passed",
      providerSideEffectsEnabled: false,
      mutationExecutionMode: "disabled",
    });
    expect(report.liveReadOperationIds).toEqual([
      "mercury.accounts.list",
      "mercury.balances.get",
      "mercury.cards.list",
      "mercury.transactions.list",
    ]);
    expect(report.mutationOperationIds).toContain("mercury.cards.freeze");
    expect(report.sensitiveReadOperationIds).toContain("mercury.attachments.get");
  });

  test("live smoke runner executes only read endpoints and returns summary counts", async () => {
    const requestedUrls: string[] = [];
    const client = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        requestedUrls.push(String(url));
        if (String(url).endsWith("/accounts?limit=1&order=asc")) {
          return jsonResponse({
            accounts: [{
              id: "acct_secret",
              accountNumber: "masked-account-7890",
              routingNumber: "masked-routing-0021",
            }],
          });
        }
        if (String(url).endsWith("/cards?limit=1")) {
          return jsonResponse({ cards: [{ id: "card_secret", lastFour: "4242", status: "active" }] });
        }
        if (String(url).endsWith("/transactions?limit=1&order=desc")) {
          return jsonResponse({ transactions: [{ id: "txn_secret", amount: "1.00", status: "posted" }] });
        }
        if (String(url).endsWith("/account/acct_secret")) {
          return jsonResponse({ id: "acct_secret", currentBalance: "100.00", availableBalance: "90.00" });
        }
        throw new Error(`unexpected URL ${String(url)}`);
      },
    });

    const summary = await runMercuryLiveReadSmoke(client, { environment: "production" });
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      providerId: "mercury",
      environment: "production",
      mode: "read_only_summary",
      status: "passed",
      counts: { accounts: 1, cards: 1, transactions: 1, balances: 1 },
      balanceSource: "first_account",
      redaction: "summary_counts_only",
      mutationExecutionMode: "disabled",
    });
    expect(summary.executedOperationIds).toEqual([
      "mercury.accounts.list",
      "mercury.balances.get",
      "mercury.cards.list",
      "mercury.transactions.list",
    ]);
    expect(requestedUrls).toEqual([
      "https://api.mercury.com/api/v1/accounts?limit=1&order=asc",
      "https://api.mercury.com/api/v1/cards?limit=1",
      "https://api.mercury.com/api/v1/transactions?limit=1&order=desc",
      "https://api.mercury.com/api/v1/account/acct_secret",
    ]);
    expect(serialized).not.toContain("acct_secret");
    expect(serialized).not.toContain("card_secret");
    expect(serialized).not.toContain("txn_secret");
    expect(serialized).not.toContain("4242");
    expect(serialized).not.toContain("7890");
  });

  test("live smoke script emits sanitized failure output", () => {
    const result = Bun.spawnSync(["bun", "scripts/smoke-mercury-live.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        PATH: Bun.env.PATH ?? "",
        HOME: Bun.env.HOME ?? "",
        BANKING_MERCURY_LIVE_SMOKE: "true",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = new TextDecoder().decode(result.stderr);
    const stdout = new TextDecoder().decode(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("\"errorClass\": \"configuration_error\"");
    expect(stderr).toContain("Output is sanitized");
    expect(stderr).not.toContain("Missing required");
    expect(stderr).not.toContain(["secret", "token:"].join("-"));
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
