/**
 * TEST-GAP suite: Mercury live smoke runner edge conditions.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * tests/mercury-live.test.ts exercises the smoke runner happy path and the
 * client's 1..1000 limit. This file locks the smoke runner's own limit
 * (1..100 with truncation of fractional values) and the balanceSource
 * classification matrix that the happy-path test cannot reach.
 */
import { describe, expect, test } from "bun:test";
import {
  createMercuryReadClient,
  runMercuryLiveReadSmoke,
  type MercuryReadClient,
} from "../src/index.ts";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

function stubClient(): MercuryReadClient {
  return createMercuryReadClient({
    environment: "production",
    apiKey: "test-token",
    fetch: async (url) => {
      if (String(url).endsWith("/accounts?limit=1&order=asc")) {
        return jsonResponse({ accounts: [{ id: "acct_1", accountNumber: "masked-1", routingNumber: "masked-2" }] });
      }
      if (String(url).endsWith("/cards?limit=1")) {
        return jsonResponse({ cards: [{ id: "card_1", lastFour: "4242", status: "active" }] });
      }
      if (String(url).endsWith("/transactions?limit=1&order=desc")) {
        return jsonResponse({ transactions: [{ id: "txn_1", amount: "1.00", status: "posted" }] });
      }
      if (String(url).endsWith("/account/acct_1")) {
        return jsonResponse({ id: "acct_1", currentBalance: "100.00", availableBalance: "90.00" });
      }
      throw new Error(`unexpected URL ${String(url)}`);
    },
  });
}

describe("Mercury live smoke runner limits", () => {
  test("rejects limits outside 1..100 before any fetch", async () => {
    const client = stubClient();
    for (const limit of [0, -1, 101, 1000, Number.NaN]) {
      await expect(runMercuryLiveReadSmoke(client, { environment: "production", limit }))
        .rejects.toThrow("Mercury live smoke limit must be between 1 and 100.");
    }
  });

  test("truncates fractional limits to integers", async () => {
    const client = stubClient();
    const summary = await runMercuryLiveReadSmoke(client, { environment: "production", limit: 1.9 });
    expect(summary.limit).toBe(1);
    expect(summary.status).toBe("passed");
  });
});

describe("Mercury live smoke balanceSource classification", () => {
  test("includeBalance: false skips the balance entirely", async () => {
    const client = stubClient();
    const summary = await runMercuryLiveReadSmoke(client, { environment: "production", includeBalance: false });
    expect(summary.balanceSource).toBe("skipped_by_option");
    expect(summary.counts.balances).toBe(0);
  });

  test("an explicit balanceAccountId wins over the first account", async () => {
    const client = stubClient();
    const summary = await runMercuryLiveReadSmoke(client, { environment: "production", balanceAccountId: "acct_1" });
    expect(summary.balanceSource).toBe("provided_account");
    expect(summary.counts.balances).toBe(1);
  });

  test("no accounts and no explicit id skips the balance as unavailable", async () => {
    const empty = createMercuryReadClient({
      environment: "production",
      apiKey: "test-token",
      fetch: async (url) => {
        if (String(url).endsWith("/accounts?limit=1&order=asc")) return jsonResponse({ accounts: [] });
        if (String(url).endsWith("/cards?limit=1")) return jsonResponse({ cards: [] });
        if (String(url).endsWith("/transactions?limit=1&order=desc")) return jsonResponse({ transactions: [] });
        throw new Error(`unexpected URL ${String(url)}`);
      },
    });
    const summary = await runMercuryLiveReadSmoke(empty, { environment: "production" });
    expect(summary.balanceSource).toBe("skipped_no_account");
    expect(summary.counts).toEqual({ accounts: 0, cards: 0, transactions: 0, balances: 0 });
  });
});
