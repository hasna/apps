import { describe, expect, test } from "bun:test";
import {
  assertErsteBcrPsd2Conformance,
  buildErsteBcrConsentLifecycleFixture,
  buildErsteBcrPaymentLifecycleFixture,
  getOperationDescriptor,
  listOperationDescriptors,
  planProviderOperation,
  preflightProviderEnv,
} from "../src/index.ts";

describe("Erste BCR PSD2 conformance gates", () => {
  test("pins BCR to PSD2 AIS/PIS conformance-only operation sets", () => {
    const report = assertErsteBcrPsd2Conformance();

    expect(report).toMatchObject({
      providerId: "erste-bcr",
      checkedAt: "2026-06-29",
      status: "passed",
      liveReadOperationIds: [],
      requiresTpp: true,
      providerSideEffectsEnabled: false,
      mutationExecutionMode: "disabled",
    });
    expect(report.aisOperationIds).toEqual(expect.arrayContaining([
      "erste-bcr.consents.create",
      "erste-bcr.accounts.list",
      "erste-bcr.balances.get",
      "erste-bcr.transactions.list",
    ]));
    expect(report.pisOperationIds).toEqual(expect.arrayContaining([
      "erste-bcr.payments.create",
      "erste-bcr.payments.status",
      "erste-bcr.paymentAuthorisations.update",
      "erste-bcr.paymentCancellationAuthorisations.update",
    ]));
    expect(report.unsupportedOperationIds).toEqual(expect.arrayContaining([
      "erste-bcr.cardAccounts.list",
      "erste-bcr.fundsConfirmations.create",
      "erste-bcr.signingBaskets.create",
      "erste-bcr.cards.createVirtual",
      "erste-bcr.cards.revealSensitiveData",
    ]));
  });

  test("keeps every Erste descriptor non-live and hides unsupported MCP surfaces", () => {
    for (const descriptor of listOperationDescriptors({ providerId: "erste-bcr", includeUnsupported: true })) {
      expect(descriptor.liveReadEnabled).toBe(false);
      expect(descriptor.providerSideEffectsEnabled).toBe(false);
      expect(descriptor.executionMode).not.toBe("implemented_read");
      if (descriptor.support === "unsupported") {
        expect(descriptor.executionMode).toBe("unsupported");
        expect(descriptor.mcp.exposed).toBe(false);
      } else {
        expect(descriptor.executionMode).toBe("dry_run_only");
        expect(descriptor.requiresOperationPlan).toBe(true);
      }
    }

    expect(getOperationDescriptor("erste-bcr.accounts.list")).toMatchObject({
      requiredScopes: ["AIS"],
      requiresRequestSigning: true,
      requiresSCA: true,
      requiresOperationPlan: true,
      liveReadEnabled: false,
    });
    expect(getOperationDescriptor("erste-bcr.cards.createVirtual")).toMatchObject({
      support: "unsupported",
      executionMode: "unsupported",
      mcp: { toolName: "banking_card_request", exposed: false },
    });
  });

  test("models consent and payment SCA fixtures without secret material", () => {
    const consent = buildErsteBcrConsentLifecycleFixture();
    const payment = buildErsteBcrPaymentLifecycleFixture();

    expect(consent).toMatchObject({
      kind: "consent_lifecycle",
      requiredScope: "AIS",
      requiredHeaders: ["X-Request-ID", "TPP-Redirect-URI", "PSU-IP-Address"],
      scaApproaches: ["redirect", "decoupled", "embedded"],
      liveExecution: false,
      providerSideEffectsEnabled: false,
    });
    expect(consent.operationIds).toEqual(expect.arrayContaining([
      "erste-bcr.consents.create",
      "erste-bcr.consents.authorisations.update",
    ]));
    expect(payment).toMatchObject({
      kind: "payment_lifecycle",
      requiredScope: "PIS",
      idempotency: {
        localKey: "intent.idempotencyKey",
        providerHeader: "X-Request-ID",
      },
      liveExecution: false,
      providerSideEffectsEnabled: false,
    });
    expect(payment.operationIds).toContain("erste-bcr.payments.create");
    for (const fixture of [consent, payment]) {
      expect(fixture.forbiddenLogFields).toEqual(expect.arrayContaining([
        "accessToken",
        "refreshToken",
        "certificatePem",
        "privateKeyPem",
        "psuPassword",
      ]));
    }
  });

  test("planner enforces AIS/PIS scopes, environment-specific credentials, and certificate paths", () => {
    const consentPlan = planProviderOperation({
      providerId: "erste-bcr",
      operation: "consents.create",
      environment: "sandbox",
      grantedScopes: ["AIS"],
      env: {
        ERSTE_SANDBOX_CLIENT_ID: "set",
        ERSTE_TPP_CERT_PATH: "set",
        ERSTE_TPP_KEY_PATH: "set",
      },
    });
    const missingCertificatePlan = planProviderOperation({
      providerId: "erste-bcr",
      operation: "consents.create",
      environment: "sandbox",
      grantedScopes: ["AIS"],
      env: { ERSTE_SANDBOX_CLIENT_ID: "set" },
    });
    const paymentPlan = planProviderOperation({
      providerId: "erste-bcr",
      operation: "payments.create",
      environment: "production",
      grantedScopes: ["PIS"],
      env: {
        ERSTE_PRODUCTION_CLIENT_ID: "set",
        ERSTE_TPP_CERT_PATH: "set",
        ERSTE_TPP_KEY_PATH: "set",
      },
    });
    const aisOnlyPaymentPlan = planProviderOperation({
      providerId: "erste-bcr",
      operation: "payments.create",
      environment: "production",
      grantedScopes: ["AIS"],
      env: {
        ERSTE_PRODUCTION_CLIENT_ID: "set",
        ERSTE_TPP_CERT_PATH: "set",
        ERSTE_TPP_KEY_PATH: "set",
      },
    });
    const envPreflight = preflightProviderEnv("erste-bcr", {
      ERSTE_PRODUCTION_CLIENT_ID: "set",
      ERSTE_TPP_CERT_PEM: "raw certificate material",
      ERSTE_TPP_KEY_PEM: "raw key material",
    });

    expect(consentPlan.status).toBe("ready_for_conformance");
    expect(consentPlan.acceptedEnvKeys).toEqual(["ERSTE_SANDBOX_CLIENT_ID", "ERSTE_TPP_CERT_PATH", "ERSTE_TPP_KEY_PATH"]);
    expect(missingCertificatePlan.status).toBe("blocked");
    expect(missingCertificatePlan.missingEnvKeys).toEqual(["ERSTE_TPP_CERT_PATH", "ERSTE_TPP_KEY_PATH"]);
    expect(paymentPlan.status).toBe("ready_for_conformance");
    expect(paymentPlan.executable).toBe(false);
    expect(paymentPlan.releaseGates.join(" ")).toContain("X-Request-ID");
    expect(aisOnlyPaymentPlan.status).toBe("blocked");
    expect(aisOnlyPaymentPlan.missingScopes).toEqual(["PIS"]);
    expect(envPreflight.allowedKeys).toEqual(["ERSTE_PRODUCTION_CLIENT_ID"]);
    expect(envPreflight.rejectedKeys).toEqual(["ERSTE_TPP_CERT_PEM", "ERSTE_TPP_KEY_PEM"]);
  });
});
