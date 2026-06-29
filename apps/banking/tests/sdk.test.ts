import { describe, expect, test } from "bun:test";
import { createBankingClient, getProvider, listProviders } from "../src/index.ts";

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
});
