import type { ProviderEnvironment, ProviderId, ProviderOperationSupport } from "../core/providers.ts";
import { listProviders } from "./capabilities.ts";
import {
  getProviderOperationContract,
  listProviderConformanceContracts,
  type ProviderEndpointContract,
  type ProviderOperationContract,
  type ProviderOperationEffect,
  type ProviderOperationKind,
} from "./contracts.ts";

export type BankingOperationSafetyClass =
  | "read"
  | "metadata_write"
  | "money_movement"
  | "card_lifecycle"
  | "sensitive_read"
  | "webhook_mutation";

export type BankingOperationExecutionMode = "implemented_read" | "dry_run_only" | "conformance_only" | "unsupported";

export interface BankingOperationCliSurface {
  readonly command: readonly string[];
  readonly providerFirstCommand: readonly string[];
  readonly implemented: boolean;
}

export interface BankingOperationMcpSurface {
  readonly toolName?: string;
  readonly exposed: boolean;
}

export interface BankingOperationDescriptor {
  readonly providerId: ProviderId;
  readonly operationId: string;
  readonly operation: ProviderOperationKind;
  readonly resource: string;
  readonly action: string;
  readonly safetyClass: BankingOperationSafetyClass;
  readonly executionMode: BankingOperationExecutionMode;
  readonly support: ProviderOperationSupport;
  readonly environments: readonly ProviderEnvironment[];
  readonly requiredScopes: readonly string[];
  readonly requiredEnv: readonly string[];
  readonly requiresApproval: boolean;
  readonly requiresIdempotencyKey: boolean;
  readonly requiresRequestSigning: boolean;
  readonly requiresSCA: boolean;
  readonly endpoint?: ProviderEndpointContract;
  readonly liveReadEnabled: boolean;
  readonly providerSideEffectsEnabled: false;
  readonly requiresOperationPlan: boolean;
  readonly cli: BankingOperationCliSurface;
  readonly mcp: BankingOperationMcpSurface;
  readonly releaseGates: readonly string[];
}

export interface ListOperationDescriptorsInput {
  readonly providerId?: ProviderId;
  readonly safetyClass?: BankingOperationSafetyClass;
  readonly includeUnsupported?: boolean;
}

const IMPLEMENTED_CLI_READS = new Set([
  "mercury.accounts.list",
  "mercury.balances.get",
  "mercury.transactions.list",
  "mercury.cards.list",
]);

const IMPLEMENTED_CLI_OPERATIONS: ReadonlySet<ProviderOperationKind> = new Set([
  "payments.create",
  "payments.status",
  "cards.createVirtual",
  "cards.updateSettings",
  "cards.freeze",
  "cards.unfreeze",
  "cards.terminate",
]);

const OPERATION_CLI_COMMANDS: Readonly<Partial<Record<ProviderOperationKind, readonly string[]>>> = {
  "accounts.list": ["accounts", "list"],
  "balances.get": ["balances", "get"],
  "transactions.list": ["transactions", "list"],
  "counterparties.list": ["counterparties", "list"],
  "payments.create": ["payments", "request"],
  "payments.status": ["payments", "status"],
  "cards.list": ["cards", "list"],
  "cards.createVirtual": ["cards", "request"],
  "cards.updateSettings": ["cards", "update"],
  "cards.freeze": ["cards", "freeze"],
  "cards.unfreeze": ["cards", "unfreeze"],
  "cards.terminate": ["cards", "terminate"],
};

const EXPOSED_MCP_TOOLS = new Set([
  "banking_providers_list",
  "banking_provider_get",
  "banking_accounts_list",
  "banking_balance_get",
  "banking_transactions_list",
  "banking_cards_list",
  "banking_payment_quote",
  "banking_payment_request",
  "banking_payment_status",
  "banking_card_request",
  "banking_card_update_request",
  "banking_card_freeze_request",
  "banking_card_unfreeze_request",
  "banking_card_terminate_request",
  "banking_ops_list",
  "banking_ops_describe",
]);

const OPERATION_MCP_TOOLS: Readonly<Partial<Record<ProviderOperationKind, string>>> = {
  "accounts.list": "banking_accounts_list",
  "balances.get": "banking_balance_get",
  "transactions.list": "banking_transactions_list",
  "payments.create": "banking_payment_request",
  "payments.status": "banking_payment_status",
  "cards.list": "banking_cards_list",
  "cards.createVirtual": "banking_card_request",
  "cards.updateSettings": "banking_card_update_request",
  "cards.freeze": "banking_card_freeze_request",
  "cards.unfreeze": "banking_card_unfreeze_request",
  "cards.terminate": "banking_card_terminate_request",
};

export function listProviderIds(): readonly ProviderId[] {
  return listProviders().map((provider) => provider.id);
}

export function isProviderId(value: string): value is ProviderId {
  return listProviderIds().includes(value as ProviderId);
}

export function parseProviderId(value: string | undefined, field = "provider"): ProviderId {
  if (!value) throw new Error(`Missing required --${field} value.`);
  if (!isProviderId(value)) throw new Error(`Unknown provider: ${value}`);
  return value;
}

export function parseProviderEnvironment(value: string | undefined, field = "environment"): ProviderEnvironment {
  if (!value) throw new Error(`Missing required --${field} value.`);
  if (value !== "sandbox" && value !== "production") throw new Error(`Unknown environment: ${value}`);
  return value;
}

export function listOperationDescriptors(input: ListOperationDescriptorsInput = {}): readonly BankingOperationDescriptor[] {
  const descriptors = listProviderConformanceContracts()
    .filter((contract) => !input.providerId || contract.providerId === input.providerId)
    .flatMap((contract) => contract.operations.map((operation) => descriptorFromContract(contract.providerId, operation)))
    .filter((descriptor) => input.includeUnsupported || descriptor.support !== "unsupported")
    .filter((descriptor) => !input.safetyClass || descriptor.safetyClass === input.safetyClass);
  return descriptors.sort((left, right) => left.operationId.localeCompare(right.operationId));
}

export function getOperationDescriptor(operationId: string): BankingOperationDescriptor | undefined {
  const [providerId, ...operationParts] = operationId.split(".");
  if (!providerId) return undefined;
  if (!isProviderId(providerId)) return undefined;
  const operation = operationParts.join(".") as ProviderOperationKind;
  const contract = getProviderOperationContract(providerId, operation);
  return contract ? descriptorFromContract(providerId, contract) : undefined;
}

export function requireOperationDescriptor(operationId: string): BankingOperationDescriptor {
  const descriptor = getOperationDescriptor(operationId);
  if (!descriptor) throw new Error(`Unknown operation: ${operationId}`);
  return descriptor;
}

export function mcpToolNameForOperation(_providerId: ProviderId, operation: ProviderOperationKind): string | undefined {
  return OPERATION_MCP_TOOLS[operation];
}

function descriptorFromContract(providerId: ProviderId, contract: ProviderOperationContract): BankingOperationDescriptor {
  const [resource, action] = contract.operation.split(".");
  const operationId = `${providerId}.${contract.operation}`;
  const safetyClass = safetyClassForEffect(contract.effect);
  return {
    providerId,
    operationId,
    operation: contract.operation,
    resource: resource ?? contract.operation,
    action: action ?? "run",
    safetyClass,
    executionMode: executionModeFor(operationId, contract),
    support: contract.support,
    environments: contract.environments,
    requiredScopes: contract.requiredScopes,
    requiredEnv: contract.requiredEnv,
    requiresApproval: contract.requiresApproval,
    requiresIdempotencyKey: contract.requiresIdempotencyKey,
    requiresRequestSigning: contract.requiresRequestSigning,
    requiresSCA: contract.requiresSCA,
    ...(contract.endpoint ? { endpoint: contract.endpoint } : {}),
    liveReadEnabled: IMPLEMENTED_CLI_READS.has(operationId) && contract.effect === "read",
    providerSideEffectsEnabled: false,
    requiresOperationPlan: requiresOperationPlan(contract),
    cli: cliSurfaceFor(providerId, contract.operation, operationId, contract.support),
    mcp: mcpSurfaceFor(providerId, contract.operation),
    releaseGates: contract.releaseGates,
  };
}

function safetyClassForEffect(effect: ProviderOperationEffect): BankingOperationSafetyClass {
  switch (effect) {
    case "read":
      return "read";
    case "money_movement":
      return "money_movement";
    case "card_side_effect":
      return "card_lifecycle";
    case "sensitive_read":
      return "sensitive_read";
    case "webhook":
      return "webhook_mutation";
  }
}

function executionModeFor(operationId: string, contract: ProviderOperationContract): BankingOperationExecutionMode {
  if (contract.support === "unsupported") return "unsupported";
  if (IMPLEMENTED_CLI_READS.has(operationId)) return "implemented_read";
  if (requiresOperationPlan(contract)) return "dry_run_only";
  return "conformance_only";
}

function cliSurfaceFor(
  providerId: ProviderId,
  operation: ProviderOperationKind,
  operationId: string,
  support: ProviderOperationSupport,
): BankingOperationCliSurface {
  const command = OPERATION_CLI_COMMANDS[operation] ?? fallbackCliCommand(operation);
  const implemented = support !== "unsupported" && (IMPLEMENTED_CLI_READS.has(operationId) || IMPLEMENTED_CLI_OPERATIONS.has(operation));
  return {
    command,
    providerFirstCommand: [providerId, ...command],
    implemented,
  };
}

function mcpSurfaceFor(providerId: ProviderId, operation: ProviderOperationKind): BankingOperationMcpSurface {
  const toolName = mcpToolNameForOperation(providerId, operation);
  return {
    ...(toolName ? { toolName } : {}),
    exposed: toolName ? EXPOSED_MCP_TOOLS.has(toolName) : false,
  };
}

function fallbackCliCommand(operation: ProviderOperationKind): readonly string[] {
  const [resource, action] = operation.split(".");
  return [resource ?? operation, cliAction(action ?? "run")];
}

function cliAction(action: string): string {
  return action.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function requiresOperationPlan(contract: ProviderOperationContract): boolean {
  if (contract.support === "unsupported") return false;
  return (
    contract.effect !== "read"
    || contract.requiresApproval
    || contract.requiresIdempotencyKey
    || contract.requiresRequestSigning
    || contract.requiresSCA
  );
}
