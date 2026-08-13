import type { ProviderEnvironment, ProviderId } from "../core/providers.ts";
import {
  getProviderConformanceContract,
  listProviderConformanceContracts,
  planProviderOperation,
  type ProviderConformanceContract,
  type ProviderOperationKind,
  type ProviderOperationPlan,
} from "./contracts.ts";

export type ProviderAdapterStage = "contract_only";

export interface ProviderAdapterDescriptor {
  readonly providerId: ProviderId;
  readonly stage: ProviderAdapterStage;
  readonly liveExecution: false;
  readonly contract: ProviderConformanceContract;
  readonly implementedOperations: readonly ProviderOperationKind[];
  readonly plannedOperations: readonly ProviderOperationKind[];
  readonly blockerSummary: string;
}

export interface StagedProviderAdapter {
  readonly descriptor: ProviderAdapterDescriptor;
  planOperation(input: {
    readonly operation: ProviderOperationKind;
    readonly environment: ProviderEnvironment;
    readonly grantedScopes?: readonly string[];
    readonly env?: Readonly<Record<string, string | undefined>>;
  }): ProviderOperationPlan;
}

export function listProviderAdapterDescriptors(): readonly ProviderAdapterDescriptor[] {
  return listProviderConformanceContracts().map(adapterDescriptorFromContract);
}

export function getProviderAdapterDescriptor(providerId: ProviderId): ProviderAdapterDescriptor | undefined {
  const contract = getProviderConformanceContract(providerId);
  return contract ? adapterDescriptorFromContract(contract) : undefined;
}

export function createStagedProviderAdapter(providerId: ProviderId): StagedProviderAdapter {
  const descriptor = getProviderAdapterDescriptor(providerId);
  if (!descriptor) throw new Error(`Unknown provider adapter: ${providerId}`);
  return {
    descriptor,
    planOperation(input) {
      return planProviderOperation({
        providerId,
        operation: input.operation,
        environment: input.environment,
        ...(input.grantedScopes ? { grantedScopes: input.grantedScopes } : {}),
        ...(input.env ? { env: input.env } : {}),
      });
    },
  };
}

function adapterDescriptorFromContract(contract: ProviderConformanceContract): ProviderAdapterDescriptor {
  return {
    providerId: contract.providerId,
    stage: "contract_only",
    liveExecution: false,
    contract,
    implementedOperations: [],
    plannedOperations: contract.operations.map((operation) => operation.operation),
    blockerSummary: "Live execution is disabled until provider conformance tests, credentials, approvals, idempotency, audit, and release gates pass.",
  };
}
