import type { ProviderOperationKind } from "./contracts.ts";
import { listOperationDescriptors, type BankingOperationDescriptor } from "./operations.ts";

export const ERSTE_BCR_CONFORMANCE_CHECKED_AT = "2026-06-29";

export const ERSTE_BCR_LIVE_READ_OPERATION_IDS = [] as const;

export const ERSTE_BCR_AIS_OPERATION_IDS = [
  "erste-bcr.consents.create",
  "erste-bcr.consents.get",
  "erste-bcr.consents.delete",
  "erste-bcr.consents.status.get",
  "erste-bcr.consents.authorisations.create",
  "erste-bcr.consents.authorisations.list",
  "erste-bcr.consents.authorisations.get",
  "erste-bcr.consents.authorisations.update",
  "erste-bcr.accounts.list",
  "erste-bcr.accounts.get",
  "erste-bcr.balances.get",
  "erste-bcr.transactions.list",
  "erste-bcr.transactions.get",
  "erste-bcr.accountCheques.list",
] as const;

export const ERSTE_BCR_PIS_OPERATION_IDS = [
  "erste-bcr.payments.create",
  "erste-bcr.payments.get",
  "erste-bcr.payments.status",
  "erste-bcr.payments.cancel",
  "erste-bcr.bulkPayments.extendedStatus.get",
  "erste-bcr.paymentAuthorisations.create",
  "erste-bcr.paymentAuthorisations.list",
  "erste-bcr.paymentAuthorisations.get",
  "erste-bcr.paymentAuthorisations.update",
  "erste-bcr.paymentCancellationAuthorisations.create",
  "erste-bcr.paymentCancellationAuthorisations.list",
  "erste-bcr.paymentCancellationAuthorisations.get",
  "erste-bcr.paymentCancellationAuthorisations.update",
  "erste-bcr.payments.creditorConfirmation.update",
] as const;

export const ERSTE_BCR_UNSUPPORTED_OPERATION_IDS = [
  "erste-bcr.cardAccounts.list",
  "erste-bcr.cardAccounts.get",
  "erste-bcr.cardBalances.get",
  "erste-bcr.cardTransactions.list",
  "erste-bcr.fundsConfirmations.create",
  "erste-bcr.signingBaskets.create",
  "erste-bcr.signingBaskets.get",
  "erste-bcr.signingBaskets.delete",
  "erste-bcr.signingBaskets.status.get",
  "erste-bcr.signingBaskets.authorisations.create",
  "erste-bcr.signingBaskets.authorisations.list",
  "erste-bcr.signingBaskets.authorisations.get",
  "erste-bcr.signingBaskets.authorisations.update",
  "erste-bcr.partyVerification.create",
  "erste-bcr.bulkPartyVerification.create",
  "erste-bcr.bulkPartyVerification.get",
  "erste-bcr.bulkPartyVerification.status.get",
  "erste-bcr.counterparties.list",
  "erste-bcr.categories.list",
  "erste-bcr.transactions.update",
  "erste-bcr.cards.list",
  "erste-bcr.cards.createVirtual",
  "erste-bcr.cards.updateSettings",
  "erste-bcr.cards.freeze",
  "erste-bcr.cards.unfreeze",
  "erste-bcr.cards.terminate",
  "erste-bcr.cards.revealSensitiveData",
  "erste-bcr.webhooks.subscribe",
] as const;

export type ErsteBcrPsd2FlowKind = "consent_lifecycle" | "payment_lifecycle";

export interface ErsteBcrPsd2FlowFixture {
  readonly providerId: "erste-bcr";
  readonly kind: ErsteBcrPsd2FlowKind;
  readonly operationIds: readonly string[];
  readonly requiredScope: "AIS" | "PIS";
  readonly requiredEnvKeys: readonly string[];
  readonly requiredHeaders: readonly string[];
  readonly scaApproaches: readonly ["redirect", "decoupled", "embedded"];
  readonly persistedStateFields: readonly string[];
  readonly forbiddenLogFields: readonly string[];
  readonly idempotency?: {
    readonly localKey: "intent.idempotencyKey";
    readonly providerHeader: "X-Request-ID";
    readonly statusOperationIds: readonly string[];
  };
  readonly liveExecution: false;
  readonly providerSideEffectsEnabled: false;
}

export interface ErsteBcrPsd2ConformanceReport {
  readonly providerId: "erste-bcr";
  readonly checkedAt: string;
  readonly status: "passed";
  readonly liveReadOperationIds: readonly string[];
  readonly aisOperationIds: readonly string[];
  readonly pisOperationIds: readonly string[];
  readonly unsupportedOperationIds: readonly string[];
  readonly consentFixture: ErsteBcrPsd2FlowFixture;
  readonly paymentFixture: ErsteBcrPsd2FlowFixture;
  readonly requiresTpp: true;
  readonly providerSideEffectsEnabled: false;
  readonly mutationExecutionMode: "disabled";
}

export function buildErsteBcrConsentLifecycleFixture(): ErsteBcrPsd2FlowFixture {
  return {
    providerId: "erste-bcr",
    kind: "consent_lifecycle",
    operationIds: ERSTE_BCR_AIS_OPERATION_IDS.filter((operationId) => operationId.includes("consents.")),
    requiredScope: "AIS",
    requiredEnvKeys: ["ERSTE_SANDBOX_CLIENT_ID", "ERSTE_TPP_CERT_PATH", "ERSTE_TPP_KEY_PATH"],
    requiredHeaders: ["X-Request-ID", "TPP-Redirect-URI", "PSU-IP-Address"],
    scaApproaches: ["redirect", "decoupled", "embedded"],
    persistedStateFields: ["consentId", "authorisationId", "scaStatus", "redirectState", "consentAccess"],
    forbiddenLogFields: forbiddenPsd2LogFields(),
    liveExecution: false,
    providerSideEffectsEnabled: false,
  };
}

export function buildErsteBcrPaymentLifecycleFixture(): ErsteBcrPsd2FlowFixture {
  return {
    providerId: "erste-bcr",
    kind: "payment_lifecycle",
    operationIds: ERSTE_BCR_PIS_OPERATION_IDS,
    requiredScope: "PIS",
    requiredEnvKeys: ["ERSTE_SANDBOX_CLIENT_ID", "ERSTE_TPP_CERT_PATH", "ERSTE_TPP_KEY_PATH"],
    requiredHeaders: ["X-Request-ID", "TPP-Redirect-URI", "PSU-IP-Address"],
    scaApproaches: ["redirect", "decoupled", "embedded"],
    persistedStateFields: ["paymentId", "authorisationId", "scaStatus", "redirectState", "providerStatus"],
    forbiddenLogFields: forbiddenPsd2LogFields(),
    idempotency: {
      localKey: "intent.idempotencyKey",
      providerHeader: "X-Request-ID",
      statusOperationIds: [
        "erste-bcr.payments.status",
        "erste-bcr.paymentAuthorisations.get",
        "erste-bcr.paymentCancellationAuthorisations.get",
      ],
    },
    liveExecution: false,
    providerSideEffectsEnabled: false,
  };
}

export function assertErsteBcrPsd2Conformance(
  descriptors: readonly BankingOperationDescriptor[] = listOperationDescriptors({
    providerId: "erste-bcr",
    includeUnsupported: true,
  }),
): ErsteBcrPsd2ConformanceReport {
  const byId = new Map(descriptors.map((descriptor) => [descriptor.operationId, descriptor]));
  const liveReadOperationIds = descriptors.filter((descriptor) => descriptor.liveReadEnabled).map((descriptor) => descriptor.operationId);
  if (liveReadOperationIds.length > 0) {
    throw new Error(`Erste BCR must not expose live reads before PSD2 transport conformance: ${liveReadOperationIds.join(", ")}`);
  }

  for (const descriptor of descriptors) {
    if (descriptor.providerSideEffectsEnabled !== false) {
      throw new Error(`Erste BCR descriptor ${descriptor.operationId} enables provider side effects.`);
    }
    if (descriptor.executionMode === "implemented_read") {
      throw new Error(`Erste BCR descriptor ${descriptor.operationId} is implemented for live reads before conformance.`);
    }
    if (descriptor.support === "unsupported" && descriptor.mcp.exposed) {
      throw new Error(`Unsupported Erste BCR descriptor ${descriptor.operationId} is exposed through MCP.`);
    }
    if (descriptor.support !== "unsupported" && descriptor.executionMode !== "dry_run_only") {
      throw new Error(`Erste BCR descriptor ${descriptor.operationId} is not dry-run only.`);
    }
  }

  assertOperationGroup(byId, ERSTE_BCR_AIS_OPERATION_IDS, "AIS", "read");
  assertOperationGroup(byId, ERSTE_BCR_PIS_OPERATION_IDS, "PIS", "payments");
  assertUnsupportedGroup(byId, ERSTE_BCR_UNSUPPORTED_OPERATION_IDS);
  assertPaymentMutationGates(byId);

  const consentFixture = buildErsteBcrConsentLifecycleFixture();
  const paymentFixture = buildErsteBcrPaymentLifecycleFixture();
  assertFixtureBoundaries(consentFixture);
  assertFixtureBoundaries(paymentFixture);

  return {
    providerId: "erste-bcr",
    checkedAt: ERSTE_BCR_CONFORMANCE_CHECKED_AT,
    status: "passed",
    liveReadOperationIds,
    aisOperationIds: [...ERSTE_BCR_AIS_OPERATION_IDS],
    pisOperationIds: [...ERSTE_BCR_PIS_OPERATION_IDS],
    unsupportedOperationIds: [...ERSTE_BCR_UNSUPPORTED_OPERATION_IDS],
    consentFixture,
    paymentFixture,
    requiresTpp: true,
    providerSideEffectsEnabled: false,
    mutationExecutionMode: "disabled",
  };
}

function assertOperationGroup(
  byId: ReadonlyMap<string, BankingOperationDescriptor>,
  operationIds: readonly string[],
  scope: "AIS" | "PIS",
  scopeArea: "read" | "payments",
): void {
  for (const operationId of operationIds) {
    const descriptor = requireDescriptor(byId, operationId);
    if (!descriptor.requiredScopes.includes(scope)) {
      throw new Error(`${operationId} must require ${scope}.`);
    }
    if (!descriptor.requiredEnv.includes("ERSTE_CLIENT_ID") || !descriptor.requiredEnv.includes("ERSTE_TPP_CERT_PATH") || !descriptor.requiredEnv.includes("ERSTE_TPP_KEY_PATH")) {
      throw new Error(`${operationId} must require client id plus certificate/key paths.`);
    }
    if (!descriptor.requiresRequestSigning) {
      throw new Error(`${operationId} must require certificate-backed request signing.`);
    }
    if (scopeArea === "payments" && !descriptor.operation.startsWith("payments.") && !descriptor.operation.startsWith("payment") && !descriptor.operation.startsWith("bulkPayments.")) {
      throw new Error(`${operationId} is listed as PIS but does not look payment-scoped.`);
    }
  }
}

function assertUnsupportedGroup(
  byId: ReadonlyMap<string, BankingOperationDescriptor>,
  operationIds: readonly string[],
): void {
  for (const operationId of operationIds) {
    const descriptor = requireDescriptor(byId, operationId);
    if (descriptor.support !== "unsupported" || descriptor.executionMode !== "unsupported" || descriptor.liveReadEnabled || descriptor.mcp.exposed) {
      throw new Error(`${operationId} must remain unsupported, non-live, and not MCP-exposed for BCR.`);
    }
  }
}

function assertPaymentMutationGates(byId: ReadonlyMap<string, BankingOperationDescriptor>): void {
  for (const operationId of [
    "erste-bcr.payments.create",
    "erste-bcr.payments.cancel",
    "erste-bcr.payments.creditorConfirmation.update",
    "erste-bcr.paymentAuthorisations.create",
    "erste-bcr.paymentAuthorisations.update",
    "erste-bcr.paymentCancellationAuthorisations.create",
    "erste-bcr.paymentCancellationAuthorisations.update",
  ]) {
    const descriptor = requireDescriptor(byId, operationId);
    if (!descriptor.requiresApproval || !descriptor.requiresIdempotencyKey || !descriptor.requiresRequestSigning || !descriptor.requiresOperationPlan) {
      throw new Error(`${operationId} must require approval, idempotency, request signing, and operation planning.`);
    }
    if (descriptor.safetyClass === "money_movement" && !descriptor.requiresSCA) {
      throw new Error(`${operationId} must require SCA for payment mutation.`);
    }
    if (!descriptor.releaseGates.join(" ").includes("X-Request-ID") && descriptor.operation === ("payments.create" as ProviderOperationKind)) {
      throw new Error("Erste BCR payment creation must mention X-Request-ID idempotency mapping.");
    }
  }
}

function assertFixtureBoundaries(fixture: ErsteBcrPsd2FlowFixture): void {
  if (fixture.liveExecution !== false || fixture.providerSideEffectsEnabled !== false) {
    throw new Error(`${fixture.kind} fixture must stay non-executable.`);
  }
  for (const field of ["accessToken", "refreshToken", "certificatePem", "privateKeyPem", "psuPassword"]) {
    if (!fixture.forbiddenLogFields.includes(field)) {
      throw new Error(`${fixture.kind} fixture must forbid logging ${field}.`);
    }
  }
}

function requireDescriptor(
  byId: ReadonlyMap<string, BankingOperationDescriptor>,
  operationId: string,
): BankingOperationDescriptor {
  const descriptor = byId.get(operationId);
  if (!descriptor) throw new Error(`Missing Erste BCR descriptor ${operationId}`);
  return descriptor;
}

function forbiddenPsd2LogFields(): readonly string[] {
  return [
    "accessToken",
    "refreshToken",
    "certificatePem",
    "privateKeyPem",
    "clientSecret",
    "psuPassword",
    "psuCredentials",
    "scaAuthenticationData",
  ];
}
