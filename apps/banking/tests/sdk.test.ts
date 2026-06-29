import { describe, expect, test } from "bun:test";
import { createBankingClient, getProvider, listProviders, moneyFromDecimal, type ActorRef } from "../src/index.ts";

describe("@hasna/banking SDK scaffold", () => {
  test("exports four initial provider capability cards", () => {
    expect(listProviders().map((provider) => provider.id)).toEqual([
      "mercury",
      "bunq",
      "revolut-business",
      "erste-bcr",
    ]);
  });

  test("marks Erste BCR as PSD2/open-banking access, not card control", () => {
    const provider = getProvider("erste-bcr");
    expect(provider?.role).toBe("open_banking_access");
    expect(provider?.capabilities.cards).toBe(false);
    expect(provider?.capabilities.requiresTpp).toBe(true);
  });

  test("client facade lists providers", () => {
    const client = createBankingClient();
    expect(client.listProviders()).toHaveLength(4);
  });

  test("client creates request-oriented payment envelopes", () => {
    const client = createBankingClient();
    const requester: ActorRef = { id: "agent-sdk", type: "agent" };
    const envelope = client.createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "sdk test",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("10.00", "USD"),
      rail: "ach",
      now: new Date("2026-06-29T10:00:00.000Z"),
    });

    expect(envelope.intent.type).toBe("payment.request");
    expect(envelope.fingerprint.payloadHash).toHaveLength(64);
    expect(envelope.policyDecision.kind).toBe("requires_approval");
  });

  test("client read surfaces fail closed for provider-backed operations", () => {
    const client = createBankingClient();
    expect(client.listAccounts({ providerId: "mercury" }).status).toBe("provider_backed_pending");
    expect(client.getBalance({ providerId: "mercury", accountId: "acct_1" }).operation).toBe("balances.get");
    expect(client.listTransactions({ providerId: "mercury", accountId: "acct_1" }).operation).toBe("transactions.list");
    expect(client.listCards({ providerId: "mercury" }).operation).toBe("cards.list");
  });
});
