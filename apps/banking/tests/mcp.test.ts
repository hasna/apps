import { describe, expect, test } from "bun:test";
import { getOperationDescriptor } from "../src/index.ts";
import { listMcpToolDescriptors, listMcpTools, runMcp, runMcpTool } from "../src/mcp/index.ts";

describe("banking-mcp scaffold", () => {
  test("declares initial agent-safe tool names", () => {
    expect(listMcpTools()).toContain("banking_providers_list");
    expect(listMcpTools()).toContain("banking_ops_list");
    expect(listMcpTools()).toContain("banking_payment_request");
    expect(listMcpTools()).toContain("banking_card_freeze_request");
    expect(listMcpTools()).toContain("banking_card_unfreeze_request");
    expect(listMcpTools()).toContain("banking_card_terminate_request");
  });

  test("help exits successfully", () => {
    expect(runMcp(["--help"])).toBe(0);
  });

  test("tool descriptors distinguish implemented and pending tools", () => {
    expect(listMcpToolDescriptors().find((tool) => tool.name === "banking_providers_list")?.status).toBe("implemented");
    expect(listMcpToolDescriptors().find((tool) => tool.name === "banking_accounts_list")?.status).toBe("provider_backed_pending");
  });

  test("local provider tool dispatch returns provider cards", () => {
    const result = runMcpTool("banking_providers_list") as { readonly providers: readonly unknown[] };
    expect(result.providers).toHaveLength(4);
  });

  test("local ops dispatch returns operation descriptors", () => {
    const list = runMcpTool("banking_ops_list", { providerId: "mercury" }) as {
      readonly operations: readonly [{ readonly operationId: string; readonly liveReadEnabled: boolean; readonly providerSideEffectsEnabled: boolean }];
    };
    expect(list.operations.map((operation) => operation.operationId)).toContain("mercury.cards.freeze");

    const describe = runMcpTool("banking_ops_describe", { operationId: "mercury.cards.freeze" }) as {
      readonly operation: { readonly operationId: string; readonly liveReadEnabled: boolean; readonly providerSideEffectsEnabled: boolean };
    };
    expect(describe.operation).toMatchObject({
      operationId: "mercury.cards.freeze",
      liveReadEnabled: false,
      providerSideEffectsEnabled: false,
    });
  });

  test("operation descriptors expose MCP tools that really exist", () => {
    const tools = listMcpTools();
    const freeze = getOperationDescriptor("mercury.cards.freeze");
    const accounts = getOperationDescriptor("mercury.accounts.list");

    expect(freeze?.mcp).toMatchObject({ toolName: "banking_card_freeze_request", exposed: true });
    expect(accounts?.mcp).toMatchObject({ toolName: "banking_accounts_list", exposed: true });

    for (const descriptor of [freeze, accounts]) {
      if (!descriptor?.mcp.exposed || !descriptor.mcp.toolName) throw new Error(`operation is not exposed: ${descriptor?.operationId ?? "missing"}`);
      expect(tools).toContain(descriptor.mcp.toolName);
    }
  });

  test("local payment request dispatch creates an approval-gated envelope", () => {
    const result = runMcpTool("banking_payment_request", {
      providerId: "mercury",
      sourceAccountId: "acct_1",
      counterpartyName: "Vendor",
      amount: "10.00",
      currency: "USD",
    }) as { readonly policyDecision: { readonly kind: string } };
    expect(result.policyDecision.kind).toBe("requires_approval");
  });

  test("local payment request dispatch ignores approval-disable input", () => {
    const result = runMcpTool("banking_payment_request", {
      providerId: "mercury",
      sourceAccountId: "acct_1",
      counterpartyName: "Vendor",
      amount: "10.00",
      currency: "USD",
      liveMode: true,
      environment: "production",
      requireApprovalForProviderSideEffects: false,
    }) as { readonly policyDecision: { readonly kind: string; readonly snapshot: { readonly requireApprovalForProviderSideEffects: boolean } } };

    expect(result.policyDecision.kind).toBe("requires_approval");
    expect(result.policyDecision.snapshot.requireApprovalForProviderSideEffects).toBe(true);
  });

  test("local MCP policy rejects invalid environment values", () => {
    expect(() => runMcpTool("banking_payment_request", {
      providerId: "mercury",
      sourceAccountId: "acct_1",
      counterpartyName: "Vendor",
      amount: "10.00",
      currency: "USD",
      liveMode: true,
      environment: "live",
    })).toThrow("Unknown environment: live");
  });

  test("local card lifecycle dispatch covers unfreeze and terminate", () => {
    const unfreeze = runMcpTool("banking_card_unfreeze_request", {
      providerId: "mercury",
      cardId: "card_1",
    }) as { readonly intent: { readonly kind: string } };
    const terminate = runMcpTool("banking_card_terminate_request", {
      providerId: "mercury",
      cardId: "card_1",
    }) as { readonly intent: { readonly kind: string } };

    expect(unfreeze.intent.kind).toBe("unfreeze");
    expect(terminate.intent.kind).toBe("terminate");
  });

  test("local read and admin dispatch return distinct gated responses", () => {
    const read = runMcpTool("banking_accounts_list", { providerId: "mercury" }) as { readonly status: string };
    const admin = runMcpTool("banking_admin_provider_verify_operation") as { readonly status: string };
    expect(read.status).toBe("provider_backed_pending");
    expect(admin.status).toBe("admin_approval_required");
  });
});
