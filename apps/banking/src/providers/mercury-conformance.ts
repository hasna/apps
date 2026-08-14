import type { ProviderEnvironment } from "../core/providers.ts";
import type { MercuryReadClient } from "./mercury-live.ts";
import { listOperationDescriptors, type BankingOperationDescriptor } from "./operations.ts";

export const MERCURY_CONFORMANCE_CHECKED_AT = "2026-06-29";

export const MERCURY_LIVE_READ_OPERATION_IDS = [
  "mercury.accounts.list",
  "mercury.balances.get",
  "mercury.cards.list",
  "mercury.transactions.list",
] as const;

export interface MercuryLiveConformanceReport {
  readonly providerId: "mercury";
  readonly checkedAt: string;
  readonly status: "passed";
  readonly liveReadOperationIds: readonly string[];
  readonly mutationOperationIds: readonly string[];
  readonly sensitiveReadOperationIds: readonly string[];
  readonly providerSideEffectsEnabled: false;
  readonly mutationExecutionMode: "disabled";
}

export interface MercuryLiveReadSmokeInput {
  readonly environment: ProviderEnvironment;
  readonly limit?: number;
  readonly balanceAccountId?: string;
  readonly includeBalance?: boolean;
}

export interface MercuryLiveReadSmokeSummary {
  readonly providerId: "mercury";
  readonly environment: ProviderEnvironment;
  readonly status: "passed";
  readonly mode: "read_only_summary";
  readonly checkedAt: string;
  readonly limit: number;
  readonly executedOperationIds: readonly string[];
  readonly counts: {
    readonly accounts: number;
    readonly cards: number;
    readonly transactions: number;
    readonly balances: number;
  };
  readonly balanceSource: "provided_account" | "first_account" | "skipped_no_account" | "skipped_by_option";
  readonly redaction: "summary_counts_only";
  readonly mutationExecutionMode: "disabled";
}

export function assertMercuryLiveConformance(
  descriptors: readonly BankingOperationDescriptor[] = listOperationDescriptors({
    providerId: "mercury",
    includeUnsupported: true,
  }),
): MercuryLiveConformanceReport {
  const liveReadIds = descriptors
    .filter((descriptor) => descriptor.liveReadEnabled)
    .map((descriptor) => descriptor.operationId)
    .sort();
  const expectedLiveReadIds = [...MERCURY_LIVE_READ_OPERATION_IDS].sort();
  assertListEqual(liveReadIds, expectedLiveReadIds, "Mercury live-read operation set drifted");

  const mutationOperationIds: string[] = [];
  const sensitiveReadOperationIds: string[] = [];

  for (const descriptor of descriptors) {
    if (descriptor.providerSideEffectsEnabled !== false) {
      throw new Error(`Mercury descriptor ${descriptor.operationId} enables provider side effects.`);
    }

    if (descriptor.liveReadEnabled) {
      if (descriptor.safetyClass !== "read" || descriptor.executionMode !== "implemented_read" || descriptor.requiresOperationPlan) {
        throw new Error(`Mercury live-read descriptor ${descriptor.operationId} is not a plain implemented read.`);
      }
      continue;
    }

    if (descriptor.executionMode === "implemented_read") {
      throw new Error(`Mercury descriptor ${descriptor.operationId} is implemented without being in the live-read allowlist.`);
    }

    if (descriptor.safetyClass === "sensitive_read") {
      sensitiveReadOperationIds.push(descriptor.operationId);
      if (descriptor.mcp.exposed !== false) {
        throw new Error(`Mercury sensitive read ${descriptor.operationId} is exposed through MCP.`);
      }
      if (descriptor.support !== "unsupported" && descriptor.requiresOperationPlan !== true) {
        throw new Error(`Mercury sensitive read ${descriptor.operationId} is not plan-only and MCP-hidden.`);
      }
    }

    if (descriptor.safetyClass !== "read" && descriptor.safetyClass !== "sensitive_read" && descriptor.support !== "unsupported") {
      mutationOperationIds.push(descriptor.operationId);
      if (descriptor.requiresOperationPlan !== true) {
        throw new Error(`Mercury mutation ${descriptor.operationId} does not require an operation plan.`);
      }
      if (descriptor.executionMode !== "dry_run_only") {
        throw new Error(`Mercury mutation ${descriptor.operationId} is not dry-run only.`);
      }
    }
  }

  return {
    providerId: "mercury",
    checkedAt: MERCURY_CONFORMANCE_CHECKED_AT,
    status: "passed",
    liveReadOperationIds: liveReadIds,
    mutationOperationIds: mutationOperationIds.sort(),
    sensitiveReadOperationIds: sensitiveReadOperationIds.sort(),
    providerSideEffectsEnabled: false,
    mutationExecutionMode: "disabled",
  };
}

export async function runMercuryLiveReadSmoke(
  client: MercuryReadClient,
  input: MercuryLiveReadSmokeInput,
): Promise<MercuryLiveReadSmokeSummary> {
  assertMercuryLiveConformance();

  const limit = smokeLimit(input.limit);
  const accounts = await client.listAccounts({ limit, order: "asc" });
  const cards = await client.listCards({ limit });
  const transactions = await client.listTransactions({ limit, order: "desc" });

  const balanceTarget = input.balanceAccountId ?? accounts[0]?.id;
  const shouldCheckBalance = input.includeBalance !== false && typeof balanceTarget === "string" && balanceTarget.length > 0;
  if (shouldCheckBalance) {
    await client.getBalance({ accountId: balanceTarget });
  }

  return {
    providerId: "mercury",
    environment: input.environment,
    status: "passed",
    mode: "read_only_summary",
    checkedAt: MERCURY_CONFORMANCE_CHECKED_AT,
    limit,
    executedOperationIds: MERCURY_LIVE_READ_OPERATION_IDS,
    counts: {
      accounts: accounts.length,
      cards: cards.length,
      transactions: transactions.length,
      balances: shouldCheckBalance ? 1 : 0,
    },
    balanceSource: balanceSource(input, accounts.length, shouldCheckBalance),
    redaction: "summary_counts_only",
    mutationExecutionMode: "disabled",
  };
}

function smokeLimit(limit: number | undefined): number {
  if (limit === undefined) return 1;
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new Error("Mercury live smoke limit must be between 1 and 100.");
  }
  return Math.trunc(limit);
}

function balanceSource(
  input: MercuryLiveReadSmokeInput,
  accountCount: number,
  checkedBalance: boolean,
): MercuryLiveReadSmokeSummary["balanceSource"] {
  if (input.includeBalance === false) return "skipped_by_option";
  if (!checkedBalance || accountCount === 0) return "skipped_no_account";
  return input.balanceAccountId ? "provided_account" : "first_account";
}

function assertListEqual(actual: readonly string[], expected: readonly string[], message: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${message}: expected ${expected.join(", ")}; got ${actual.join(", ")}`);
  }
}
