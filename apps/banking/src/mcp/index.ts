#!/usr/bin/env bun
import {
  createBankingClient,
  listOperationDescriptors,
  moneyInput,
  parseProviderEnvironment,
  parseProviderId,
  requireOperationDescriptor,
  type BankingPolicy,
  type CurrencyCode,
  type PaymentRail,
  type ProviderId,
} from "../index.ts";

const VERSION = "0.0.6";

export type McpToolStatus = "implemented" | "provider_backed_pending" | "admin_gated";

export interface McpToolDescriptor {
  readonly name: string;
  readonly status: McpToolStatus;
  readonly description: string;
}

const TOOL_DESCRIPTORS: readonly McpToolDescriptor[] = [
  { name: "banking_ops_list", status: "implemented", description: "List provider operation descriptors." },
  { name: "banking_ops_describe", status: "implemented", description: "Describe one provider operation descriptor." },
  { name: "banking_providers_list", status: "implemented", description: "List provider capability cards." },
  { name: "banking_provider_get", status: "implemented", description: "Get one provider capability card." },
  { name: "banking_accounts_list", status: "provider_backed_pending", description: "List provider accounts once adapters are implemented." },
  { name: "banking_balance_get", status: "provider_backed_pending", description: "Get a provider account balance once adapters are implemented." },
  { name: "banking_transactions_list", status: "provider_backed_pending", description: "List transactions once adapters are implemented." },
  { name: "banking_cards_list", status: "provider_backed_pending", description: "List cards once adapters are implemented." },
  { name: "banking_payment_quote", status: "implemented", description: "Create a local payment quote intent envelope." },
  { name: "banking_payment_request", status: "implemented", description: "Create a local payment request intent envelope." },
  { name: "banking_payment_status", status: "implemented", description: "Create a local payment status intent envelope." },
  { name: "banking_card_request", status: "implemented", description: "Create a local virtual-card request intent envelope." },
  { name: "banking_card_update_request", status: "implemented", description: "Create a local card update intent envelope." },
  { name: "banking_card_freeze_request", status: "implemented", description: "Create a local card freeze intent envelope." },
  { name: "banking_card_unfreeze_request", status: "implemented", description: "Create a local card unfreeze intent envelope." },
  { name: "banking_card_terminate_request", status: "implemented", description: "Create a local card termination intent envelope." },
  { name: "banking_admin_provider_verify_operation", status: "admin_gated", description: "Future admin-gated provider operation verification." },
];

function printHelp(): void {
  console.log(`banking-mcp ${VERSION}

Implemented now:
  --help
  --version
  --list-tools

This entrypoint exposes stable tool descriptors and local request-envelope dispatch helpers.
The full MCP protocol server lands after the store/provider adapter nodes.`);
}

export function listMcpTools(): readonly string[] {
  return TOOL_DESCRIPTORS.map((tool) => tool.name);
}

export function listMcpToolDescriptors(): readonly McpToolDescriptor[] {
  return TOOL_DESCRIPTORS;
}

export function listPlannedMcpTools(): readonly { readonly name: string; readonly status: McpToolStatus }[] {
  return TOOL_DESCRIPTORS.map(({ name, status }) => ({ name, status }));
}

export function runMcpTool(name: string, input: Readonly<Record<string, unknown>> = {}): unknown {
  const client = createBankingClient();
  switch (name) {
    case "banking_ops_list":
      return {
        operations: listOperationDescriptors({
          ...(optionalString(input.providerId) ? { providerId: providerId(input.providerId) } : {}),
          includeUnsupported: input.includeUnsupported === true,
        }),
      };
    case "banking_ops_describe":
      return { operation: requireOperationDescriptor(requiredString(input.operationId, "operationId")) };
    case "banking_providers_list":
      return { providers: client.listProviders() };
    case "banking_provider_get":
      return { provider: client.getProvider(providerId(input.providerId)) };
    case "banking_accounts_list":
      return client.listAccounts({ providerId: providerId(input.providerId) });
    case "banking_balance_get":
      return client.getBalance({
        providerId: providerId(input.providerId),
        accountId: requiredString(input.accountId, "accountId"),
      });
    case "banking_transactions_list":
      return client.listTransactions({
        providerId: providerId(input.providerId),
        accountId: requiredString(input.accountId, "accountId"),
      });
    case "banking_cards_list":
      return client.listCards({ providerId: providerId(input.providerId) });
    case "banking_payment_quote":
      return client.createPaymentQuote(paymentInput(input), policyInput(input));
    case "banking_payment_request":
      return client.createPaymentRequest(paymentInput(input), policyInput(input));
    case "banking_payment_status":
      const providerPaymentId = optionalString(input.providerPaymentId);
      return client.createPaymentStatus({
        providerId: providerId(input.providerId),
        requester: actor(input),
        reason: stringInput(input.reason, "payment status requested from MCP"),
        paymentRequestId: requiredString(input.paymentRequestId, "paymentRequestId"),
        ...(providerPaymentId ? { providerPaymentId } : {}),
      }, policyInput(input));
    case "banking_card_request":
      return client.createCardRequest({
        providerId: providerId(input.providerId),
        requester: actor(input),
        reason: stringInput(input.reason, "virtual card requested from MCP"),
        accountId: requiredString(input.accountId, "accountId"),
        label: requiredString(input.label, "label"),
      }, policyInput(input));
    case "banking_card_update_request":
      const label = optionalString(input.label);
      return client.createCardUpdate({
        providerId: providerId(input.providerId),
        requester: actor(input),
        reason: stringInput(input.reason, "card update requested from MCP"),
        cardId: requiredString(input.cardId, "cardId"),
        ...(label ? { label } : {}),
      }, policyInput(input));
    case "banking_card_freeze_request":
      return cardLifecycle(input, "freeze", "card freeze requested from MCP");
    case "banking_card_unfreeze_request":
      return cardLifecycle(input, "unfreeze", "card unfreeze requested from MCP");
    case "banking_card_terminate_request":
      return cardLifecycle(input, "terminate", "card termination requested from MCP");
    case "banking_admin_provider_verify_operation":
      return {
        status: "admin_approval_required",
        tool: name,
        message: "Administrative provider operation verification is gated and must run through the provider conformance workflow.",
      };
    default:
      return {
        status: "not_implemented",
        tool: name,
        message: "This MCP tool is provider-backed, admin-gated, or not implemented yet.",
      };
  }
}

export function runMcp(argv: readonly string[] = Bun.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(VERSION);
    return 0;
  }

  if (argv.includes("--list-tools")) {
    console.log(JSON.stringify({ tools: listMcpToolDescriptors(), providers: createBankingClient().listProviders() }, null, 2));
    return 0;
  }

  console.error("banking-mcp: full MCP protocol server is not implemented yet.");
  return 1;
}

function paymentInput(input: Readonly<Record<string, unknown>>) {
  const providerRecipientId = optionalString(input.providerRecipientId);
  return {
    providerId: providerId(input.providerId),
    requester: actor(input),
    reason: stringInput(input.reason, "payment intent requested from MCP"),
    sourceAccountId: requiredString(input.sourceAccountId, "sourceAccountId"),
    counterparty: {
      name: requiredString(input.counterpartyName, "counterpartyName"),
      ...(providerRecipientId ? { providerRecipientId } : {}),
    },
    amount: moneyInput(requiredString(input.amount, "amount"), requiredString(input.currency, "currency").toUpperCase() as CurrencyCode),
    rail: stringInput(input.rail, "ach") as PaymentRail,
  };
}

function policyInput(input: Readonly<Record<string, unknown>>): BankingPolicy {
  return {
    liveMode: input.liveMode === true,
    environment: input.environment === undefined ? "sandbox" : parseProviderEnvironment(requiredString(input.environment, "environment"), "environment"),
    requireApprovalForProviderSideEffects: true,
    allowSensitiveCardData: false,
  };
}

function actor(input: Readonly<Record<string, unknown>>) {
  return {
    id: stringInput(input.actorId, "agent-mcp"),
    type: "agent" as const,
  };
}

function providerId(value: unknown): ProviderId {
  return parseProviderId(requiredString(value, "providerId"), "providerId");
}

function cardLifecycle(input: Readonly<Record<string, unknown>>, kind: "freeze" | "unfreeze" | "terminate", fallbackReason: string) {
  return createBankingClient().createCardLifecycle({
    providerId: providerId(input.providerId),
    requester: actor(input),
    reason: stringInput(input.reason, fallbackReason),
    cardId: requiredString(input.cardId, "cardId"),
    kind,
  }, policyInput(input));
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required ${field}.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringInput(value: unknown, fallback: string): string {
  return optionalString(value) ?? fallback;
}

if (import.meta.main) {
  process.exit(runMcp());
}
