import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli/index.ts";

describe("banking CLI scaffold", () => {
  test("help exits successfully", async () => {
    expect(await runCli(["--help"])).toBe(0);
  });

  test("version exits successfully without help output", async () => {
    const originalLog = console.log;
    let output = "";
    console.log = (...args: unknown[]) => {
      output += args.join(" ");
    };
    try {
      expect(await runCli(["--version"])).toBe(0);
      expect(await runCli(["-v"])).toBe(0);
    } finally {
      console.log = originalLog;
    }

    expect(output).toBe("0.0.50.0.5");
    expect(output).not.toContain("Usage:");
  });

  test("provider list exits successfully", async () => {
    expect(await runCli(["providers", "list", "--json"])).toBe(0);
  });

  test("payment request envelope exits successfully", async () => {
    const originalLog = console.log;
    let output = "";
    console.log = (...args: unknown[]) => {
      output += args.join(" ");
    };
    try {
      expect(await runCli([
        "payments",
        "request",
        "--provider",
        "mercury",
        "--account",
        "acct_1",
        "--amount",
        "10.00",
        "--currency",
        "USD",
        "--to",
        "Vendor",
        "--recipient",
        "recipient_123",
        "--json",
      ])).toBe(0);
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(output) as {
      readonly intent: {
        readonly counterparty: { readonly providerRecipientId?: string };
      };
    };
    expect(parsed.intent.counterparty.providerRecipientId).toBe("recipient_123");
  });

  test("payment request ignores approval-disable flag", async () => {
    const originalLog = console.log;
    let output = "";
    console.log = (...args: unknown[]) => {
      output += args.join(" ");
    };
    try {
      expect(await runCli([
        "payments",
        "request",
        "--provider",
        "mercury",
        "--account",
        "acct_1",
        "--amount",
        "10.00",
        "--currency",
        "USD",
        "--to",
        "Vendor",
        "--live",
        "true",
        "--environment",
        "production",
        "--require-approval",
        "false",
        "--json",
      ])).toBe(0);
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(output) as {
      readonly policyDecision: {
        readonly kind: string;
        readonly snapshot: { readonly requireApprovalForProviderSideEffects: boolean };
      };
    };
    expect(parsed.policyDecision.kind).toBe("requires_approval");
    expect(parsed.policyDecision.snapshot.requireApprovalForProviderSideEffects).toBe(true);
  });

  test("card request envelope exits successfully even when policy denies execution", async () => {
    expect(await runCli([
      "cards",
      "request",
      "--provider",
      "mercury",
      "--account",
      "acct_1",
      "--label",
      "Ops",
      "--limit-month",
      "50.00",
      "--currency",
      "USD",
      "--json",
    ])).toBe(0);
  });

  test("admin commands are gated", async () => {
    expect(await runCli(["admin", "providers", "verify-operation", "--json"])).toBe(3);
  });

  test("unknown command fails closed", async () => {
    expect(await runCli(["pay", "now"])).toBe(1);
  });

  test("unimplemented provider-backed commands fail closed", async () => {
    expect(await runCli(["accounts", "list", "--json"])).toBe(2);
  });

  test("Mercury live accounts list uses explicit secret key and redacts account numbers", async () => {
    const originalLog = console.log;
    let output = "";
    console.log = (...args: unknown[]) => {
      output += args.join(" ");
    };
    try {
      expect(await runCli([
        "accounts",
        "list",
        "--provider",
        "mercury",
        "--live",
        "true",
        "--environment",
        "production",
        "--secret-key",
        "fixture-secret-key",
        "--limit",
        "1",
        "--json",
      ], {
        readSecret: (key) => key === "fixture-secret-key" ? "test-token" : undefined,
        fetch: async (url, init) => {
          expect(String(url)).toBe("https://api.mercury.com/api/v1/accounts?limit=1");
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
          return new Response(JSON.stringify({
            accounts: [{
              id: "acct_123",
              name: "Ops",
              accountNumber: "masked-account-7890",
              routingNumber: "masked-routing-0021",
              currentBalance: "10.00",
              availableBalance: "9.00",
            }],
            page: {},
          }));
        },
      })).toBe(0);
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(output) as {
      readonly accounts: readonly [{
        readonly id: string;
        readonly accountNumber?: string;
        readonly accountNumberLast4?: string;
        readonly routingNumber?: string;
        readonly routingNumberLast4?: string;
      }];
    };
    expect(parsed.accounts[0].id).toBe("acct_123");
    expect(parsed.accounts[0].accountNumber).toBeUndefined();
    expect(parsed.accounts[0].routingNumber).toBeUndefined();
    expect(parsed.accounts[0].accountNumberLast4).toBe("7890");
    expect(parsed.accounts[0].routingNumberLast4).toBe("0021");
  });

  test("Mercury live cards list uses the org-wide endpoint and accepts limit", async () => {
    const originalLog = console.log;
    let output = "";
    console.log = (...args: unknown[]) => {
      output += args.join(" ");
    };
    try {
      expect(await runCli([
        "cards",
        "list",
        "--provider",
        "mercury",
        "--live",
        "true",
        "--environment",
        "production",
        "--secret-key",
        "fixture-secret-key",
        "--limit",
        "2",
        "--json",
      ], {
        readSecret: () => "test-token",
        fetch: async (url) => {
          expect(String(url)).toBe("https://api.mercury.com/api/v1/cards?limit=2");
          return new Response(JSON.stringify({
            cards: [{ id: "card_1", accountId: "acct_1", lastFour: "4242", status: "active", type: "virtual", kind: "credit" }],
            page: {},
          }));
        },
      })).toBe(0);
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(output) as {
      readonly cards: readonly [{ readonly id: string; readonly kind?: string; readonly type?: string }];
    };
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0]).toMatchObject({ id: "card_1", kind: "credit", type: "virtual" });
  });

  test("Mercury live cards list can filter by account", async () => {
    const originalLog = console.log;
    let output = "";
    console.log = (...args: unknown[]) => {
      output += args.join(" ");
    };
    try {
      expect(await runCli([
        "cards",
        "list",
        "--provider",
        "mercury",
        "--account",
        "acct_1",
        "--live",
        "true",
        "--environment",
        "production",
        "--secret-key",
        "fixture-secret-key",
        "--limit",
        "1",
        "--json",
      ], {
        readSecret: () => "test-token",
        fetch: async (url) => {
          expect(String(url)).toBe("https://api.mercury.com/api/v1/cards?accountId=acct_1&limit=1");
          return new Response(JSON.stringify({ cards: [{ id: "card_1", accountId: "acct_1", lastFour: "4242", status: "active" }] }));
        },
      })).toBe(0);
    } finally {
      console.log = originalLog;
    }

    expect(JSON.parse(output).cards).toHaveLength(1);
  });

  test("Mercury live reads require explicit environment", async () => {
    const originalError = console.error;
    let output = "";
    console.error = (...args: unknown[]) => {
      output += args.join(" ");
    };
    try {
      expect(await runCli([
        "accounts",
        "list",
        "--provider",
        "mercury",
        "--live",
        "true",
        "--json",
      ], {
        readSecret: () => "test-token",
        fetch: async () => {
          throw new Error("should not call Mercury without explicit environment");
        },
      })).toBe(1);
    } finally {
      console.error = originalError;
    }

    expect(output).toContain("Missing required --environment value.");
  });
});
