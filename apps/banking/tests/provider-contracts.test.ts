import { describe, expect, test } from "bun:test";
import {
  createStagedProviderAdapter,
  getProviderConformanceContract,
  getProvider,
  getOperationDescriptor,
  listProviderAdapterDescriptors,
  listProviderConformanceContracts,
  listOperationDescriptors,
  MERCURY_LIVE_READ_OPERATION_IDS,
  planProviderOperation,
} from "../src/index.ts";

describe("provider conformance contracts", () => {
  test("exports one current contract per initial provider", () => {
    expect(listProviderConformanceContracts().map((contract) => contract.providerId)).toEqual([
      "mercury",
      "bunq",
      "revolut-business",
      "erste-bcr",
    ]);
    for (const contract of listProviderConformanceContracts()) {
      expect(contract.checkedAt).toBe("2026-06-29");
      expect(contract.docs.length).toBeGreaterThan(0);
      expect(contract.operations.length).toBeGreaterThan(0);
    }
  });

  test("Mercury card creation is contract-only until lifecycle conformance verifies the new API", () => {
    const contract = getProviderConformanceContract("mercury");
    const operation = contract?.operations.find((candidate) => candidate.operation === "cards.createVirtual");
    const plan = planProviderOperation({
      providerId: "mercury",
      operation: "cards.createVirtual",
      environment: "sandbox",
      grantedScopes: ["cards:write"],
      env: { MERCURY_API_KEY: "set" },
    });

    expect(operation?.support).toBe("documented_unverified");
    expect(operation?.environments).toEqual(["sandbox", "production"]);
    expect(operation?.requiresApproval).toBe(true);
    expect(operation?.requiresIdempotencyKey).toBe(true);
    expect(plan.status).toBe("ready_for_conformance");
    expect(plan.executable).toBe(false);
    expect(plan.reasons).toContain("Provider operation is not verified for live execution; only conformance planning is allowed.");
  });

  test("Mercury payment contract encodes documented send-money constraints", () => {
    const contract = getProviderConformanceContract("mercury");
    const operation = contract?.operations.find((candidate) => candidate.operation === "payments.create");
    const gates = `${contract?.constraints.join(" ")} ${operation?.releaseGates.join(" ")}`;

    expect(operation?.requiresIdempotencyKey).toBe(true);
    expect(operation?.requiredScopes).toEqual(["transactions:write"]);
    expect(operation?.endpoint).toEqual({ method: "POST", path: "/api/v1/account/{accountId}/transactions" });
    expect(gates).toContain("recipientId");
    expect(gates).toContain("amount >= 0.01");
    expect(gates).toContain("ach, check, or domesticWire");
    expect(gates).toContain("purpose");
  });

  test("Mercury contract covers the current official API families as plan-only descriptors", () => {
    const contract = getProviderConformanceContract("mercury");
    const operationIds = contract?.operations.map((operation) => operation.operation) ?? [];
    const internalTransfer = contract?.operations.find((candidate) => candidate.operation === "internalTransfers.create");
    const attachment = getOperationDescriptor("mercury.attachments.get");
    const recipientAttachments = getOperationDescriptor("mercury.recipients.attachments.list");
    const webhookVerify = getOperationDescriptor("mercury.webhooks.verify");

    expect(operationIds.length).toBeGreaterThanOrEqual(70);
    expect(operationIds).toEqual(expect.arrayContaining([
      "accountStatements.download",
      "attachments.get",
      "categories.create",
      "customers.create",
      "events.list",
      "invoices.download",
      "internalTransfers.create",
      "oauth.startFlow",
      "onboarding.submit",
      "payments.requestSendMoney",
      "recipients.attachments.upload",
      "safes.download",
      "sendMoneyApprovalRequests.list",
      "treasury.statements.list",
      "users.list",
      "webhooks.verify",
    ]));
    expect(internalTransfer).toMatchObject({
      effect: "money_movement",
      endpoint: { method: "POST", path: "/api/v1/transfer" },
      requiresApproval: true,
      requiresIdempotencyKey: true,
    });
    expect(attachment).toMatchObject({
      safetyClass: "sensitive_read",
      requiresOperationPlan: true,
      endpoint: { method: "GET", path: "/api/v1/ar/attachments/{attachmentId}" },
    });
    expect(recipientAttachments).toMatchObject({
      safetyClass: "sensitive_read",
      requiresOperationPlan: true,
      endpoint: { method: "GET", path: "/api/v1/recipients/attachments" },
    });
    expect(webhookVerify).toMatchObject({
      safetyClass: "webhook_mutation",
      requiresOperationPlan: true,
      endpoint: { method: "POST", path: "/api/v1/webhooks/{webhookEndpointId}/verify" },
    });
  });

  test("Mercury planner handles API-key aliases and OAuth env requirements per operation", () => {
    const apiPlan = planProviderOperation({
      providerId: "mercury",
      operation: "transactions.list",
      environment: "production",
      grantedScopes: ["transactions:read"],
      env: { MERCURY_PRODUCTION_API_KEY: "set" },
    });
    const oauthPlan = planProviderOperation({
      providerId: "mercury",
      operation: "oauth.startFlow",
      environment: "production",
      env: { MERCURY_OAUTH_CLIENT_ID: "set" },
    });
    const wrongEnvironmentKeyPlan = planProviderOperation({
      providerId: "mercury",
      operation: "transactions.list",
      environment: "production",
      grantedScopes: ["transactions:read"],
      env: { MERCURY_SANDBOX_API_KEY: "set" },
    });

    expect(apiPlan.missingEnvKeys).toEqual([]);
    expect(apiPlan.acceptedEnvKeys).toEqual(["MERCURY_PRODUCTION_API_KEY"]);
    expect(wrongEnvironmentKeyPlan.status).toBe("blocked");
    expect(wrongEnvironmentKeyPlan.acceptedEnvKeys).toEqual([]);
    expect(wrongEnvironmentKeyPlan.missingEnvKeys).toContain("MERCURY_PRODUCTION_API_KEY");
    expect(oauthPlan.status).toBe("blocked");
    expect(oauthPlan.missingEnvKeys).toContain("MERCURY_OAUTH_REDIRECT_URI");
    expect(oauthPlan.missingEnvKeys).not.toContain("MERCURY_API_KEY");
  });

  test("Mercury request-send-money uses the approval-specific scope", () => {
    const operation = getProviderConformanceContract("mercury")?.operations.find((candidate) => candidate.operation === "payments.requestSendMoney");
    const plan = planProviderOperation({
      providerId: "mercury",
      operation: "payments.requestSendMoney",
      environment: "sandbox",
      grantedScopes: ["RequestSendMoney"],
      env: { MERCURY_SANDBOX_API_KEY: "set" },
    });

    expect(operation?.requiredScopes).toEqual(["RequestSendMoney"]);
    expect(plan.status).toBe("ready_for_conformance");
    expect(plan.missingScopes).toEqual([]);
    expect(operation?.releaseGates.join(" ")).toContain("RequestSendMoney");
  });

  test("Mercury and bunq do not expose sensitive card data without exact endpoint evidence", () => {
    for (const providerId of ["mercury", "bunq"] as const) {
      const provider = getProvider(providerId);
      const operation = getProviderConformanceContract(providerId)?.operations.find((candidate) => candidate.operation === "cards.revealSensitiveData");
      const plan = planProviderOperation({
        providerId,
        operation: "cards.revealSensitiveData",
        environment: "production",
        grantedScopes: [],
        env: {},
      });

      expect(provider?.capabilities.sensitiveCardData).toBe(false);
      expect(provider?.scopes.sensitiveCardData).toEqual([]);
      expect(provider?.cardOperations.revealSensitiveData).toBe("unsupported");
      expect(operation?.support).toBe("unsupported");
      expect(plan.status).toBe("blocked");
      expect(plan.reasons).toContain("Provider contract marks operation unsupported.");
    }
  });

  test("Revolut Business card management blocks sandbox plans", () => {
    const operation = getProviderConformanceContract("revolut-business")?.operations.find((candidate) => candidate.operation === "cards.createVirtual");
    const plan = planProviderOperation({
      providerId: "revolut-business",
      operation: "cards.createVirtual",
      environment: "sandbox",
      grantedScopes: ["WRITE"],
      env: { REVOLUT_CLIENT_ID: "set", REVOLUT_PRIVATE_KEY: "set" },
    });

    expect(operation?.environments).toEqual(["production"]);
    expect(operation?.releaseGates.join(" ")).toContain("Blocked in Sandbox");
    expect(plan.status).toBe("blocked");
    expect(plan.reasons).toContain("Provider contract does not support sandbox for cards.createVirtual.");
  });

  test("bunq write operations require request signing and private-key credentials", () => {
    const operation = getProviderConformanceContract("bunq")?.operations.find((candidate) => candidate.operation === "payments.create");
    const contract = getProviderConformanceContract("bunq");
    const missingEnv = planProviderOperation({
      providerId: "bunq",
      operation: "payments.create",
      environment: "sandbox",
      grantedScopes: ["payment:write"],
      env: { BUNQ_API_KEY: "set" },
    });

    expect(operation?.requiresRequestSigning).toBe(true);
    expect(operation?.requiredEnv).toContain("BUNQ_PRIVATE_KEY");
    expect(contract?.constraints.join(" ")).toContain("X-Bunq-Client-Authentication");
    expect(contract?.constraints.join(" ")).toContain("X-Bunq-Client-Request-Id");
    expect(contract?.constraints.join(" ")).toContain("geolocation headers");
    expect(missingEnv.status).toBe("blocked");
    expect(missingEnv.missingEnvKeys).toContain("BUNQ_PRIVATE_KEY");
  });

  test("Erste BCR stays PSD2 AIS/PIS-only and blocks direct card control", () => {
    const contract = getProviderConformanceContract("erste-bcr");
    const cardPlan = planProviderOperation({
      providerId: "erste-bcr",
      operation: "cards.createVirtual",
      environment: "production",
      grantedScopes: ["PIS"],
      env: { ERSTE_CLIENT_ID: "set", ERSTE_TPP_CERT_PATH: "set", ERSTE_TPP_KEY_PATH: "set" },
    });
    const payment = contract?.operations.find((candidate) => candidate.operation === "payments.create");
    const paymentStatus = contract?.operations.find((candidate) => candidate.operation === "payments.status");
    const paymentAuthorisationUpdate = contract?.operations.find((candidate) => candidate.operation === "paymentAuthorisations.update");

    expect(payment?.requiresSCA).toBe(true);
    expect(payment?.requiredScopes).toEqual(["PIS"]);
    expect(payment?.endpoint).toEqual({ method: "POST", path: "/v1/{payment-service}/{payment-product}" });
    expect(paymentStatus?.requiredScopes).toEqual(["PIS"]);
    expect(paymentStatus?.scopeArea).toBe("payments");
    expect(paymentAuthorisationUpdate?.requiredScopes).toEqual(["PIS"]);
    expect(paymentAuthorisationUpdate?.scopeArea).toBe("payments");
    expect(cardPlan.status).toBe("blocked");
    expect(cardPlan.reasons).toContain("Provider contract marks operation unsupported.");
  });

  test("Erste BCR contract covers Berlin Group PSD2 AIS/PIS and consent flows", () => {
    const contract = getProviderConformanceContract("erste-bcr");
    const operationIds = contract?.operations.map((operation) => operation.operation) ?? [];
    const consentCreate = getOperationDescriptor("erste-bcr.consents.create");
    const paymentAuthorisation = getOperationDescriptor("erste-bcr.paymentAuthorisations.update");
    const cardAccount = getOperationDescriptor("erste-bcr.cardAccounts.list");
    const fundsConfirmation = getOperationDescriptor("erste-bcr.fundsConfirmations.create");

    expect(operationIds.length).toBeGreaterThanOrEqual(55);
    expect(operationIds).toEqual(expect.arrayContaining([
      "oauth.startFlow",
      "consents.create",
      "consents.status.get",
      "consents.authorisations.update",
      "accounts.get",
      "balances.get",
      "transactions.get",
      "payments.create",
      "payments.cancel",
      "bulkPayments.extendedStatus.get",
      "paymentAuthorisations.create",
      "paymentCancellationAuthorisations.update",
      "payments.creditorConfirmation.update",
    ]));
    expect(contract?.docs.map((doc) => doc.url)).toContain("https://gitlab.com/the-berlin-group/nextgenpsd2");
    expect(contract?.constraints.join(" ")).toContain("NextGenPSD2 core v1.3.16");
    expect(consentCreate).toMatchObject({
      safetyClass: "auth_flow",
      requiresOperationPlan: true,
      requiresRequestSigning: true,
      endpoint: { method: "POST", path: "/v1/consents" },
    });
    expect(paymentAuthorisation).toMatchObject({
      safetyClass: "auth_flow",
      requiresOperationPlan: true,
      endpoint: { method: "PUT", path: "/v1/{payment-service}/{payment-product}/{paymentId}/authorisations/{authorisationId}" },
    });
    expect(cardAccount).toMatchObject({
      support: "unsupported",
      executionMode: "unsupported",
    });
    expect(fundsConfirmation).toMatchObject({
      support: "unsupported",
      executionMode: "unsupported",
    });
  });

  test("Erste BCR planner handles environment-scoped TPP credentials", () => {
    const sandboxPlan = planProviderOperation({
      providerId: "erste-bcr",
      operation: "payments.create",
      environment: "sandbox",
      grantedScopes: ["PIS"],
      env: {
        ERSTE_SANDBOX_CLIENT_ID: "set",
        ERSTE_TPP_CERT_PATH: "set",
        ERSTE_TPP_KEY_PATH: "set",
      },
    });
    const wrongEnvironmentPlan = planProviderOperation({
      providerId: "erste-bcr",
      operation: "payments.create",
      environment: "production",
      grantedScopes: ["PIS"],
      env: {
        ERSTE_SANDBOX_CLIENT_ID: "set",
        ERSTE_TPP_CERT_PATH: "set",
        ERSTE_TPP_KEY_PATH: "set",
      },
    });
    const aisOnlyPaymentStatusPlan = planProviderOperation({
      providerId: "erste-bcr",
      operation: "payments.status",
      environment: "production",
      grantedScopes: ["AIS"],
      env: {
        ERSTE_PRODUCTION_CLIENT_ID: "set",
        ERSTE_TPP_CERT_PATH: "set",
        ERSTE_TPP_KEY_PATH: "set",
      },
    });
    const pisPaymentStatusPlan = planProviderOperation({
      providerId: "erste-bcr",
      operation: "payments.status",
      environment: "production",
      grantedScopes: ["PIS"],
      env: {
        ERSTE_PRODUCTION_CLIENT_ID: "set",
        ERSTE_TPP_CERT_PATH: "set",
        ERSTE_TPP_KEY_PATH: "set",
      },
    });
    const oauthPlan = planProviderOperation({
      providerId: "erste-bcr",
      operation: "oauth.startFlow",
      environment: "production",
      env: {
        ERSTE_PRODUCTION_CLIENT_ID: "set",
        ERSTE_PRODUCTION_CLIENT_SECRET: "set",
      },
    });

    expect(sandboxPlan.status).toBe("ready_for_conformance");
    expect(sandboxPlan.acceptedEnvKeys).toEqual(["ERSTE_SANDBOX_CLIENT_ID", "ERSTE_TPP_CERT_PATH", "ERSTE_TPP_KEY_PATH"]);
    expect(sandboxPlan.missingEnvKeys).toEqual([]);
    expect(sandboxPlan.executable).toBe(false);
    expect(wrongEnvironmentPlan.status).toBe("blocked");
    expect(wrongEnvironmentPlan.acceptedEnvKeys).toEqual(["ERSTE_TPP_CERT_PATH", "ERSTE_TPP_KEY_PATH"]);
    expect(wrongEnvironmentPlan.missingEnvKeys).toContain("ERSTE_PRODUCTION_CLIENT_ID");
    expect(aisOnlyPaymentStatusPlan.status).toBe("blocked");
    expect(aisOnlyPaymentStatusPlan.missingScopes).toEqual(["PIS"]);
    expect(pisPaymentStatusPlan.status).toBe("ready_for_conformance");
    expect(pisPaymentStatusPlan.missingScopes).toEqual([]);
    expect(oauthPlan.status).toBe("blocked");
    expect(oauthPlan.missingEnvKeys).toEqual(["ERSTE_REDIRECT_URI"]);
  });

  test("staged adapters expose plan-only descriptors with no live execution", () => {
    const descriptors = listProviderAdapterDescriptors();
    const adapter = createStagedProviderAdapter("mercury");
    const plan = adapter.planOperation({
      operation: "payments.create",
      environment: "sandbox",
      grantedScopes: ["transactions:write"],
      env: { MERCURY_API_KEY: "set" },
    });

    expect(descriptors).toHaveLength(4);
    expect(descriptors.every((descriptor) => descriptor.stage === "contract_only")).toBe(true);
    expect(descriptors.every((descriptor) => descriptor.liveExecution === false)).toBe(true);
    expect(descriptors.every((descriptor) => descriptor.implementedOperations.length === 0)).toBe(true);
    expect(adapter.descriptor.plannedOperations).toContain("payments.create");
    expect(plan.status).toBe("ready_for_conformance");
    expect(plan.executable).toBe(false);
  });

  test("operation registry derives provider descriptors from conformance contracts", () => {
    const mercuryOperations = listOperationDescriptors({ providerId: "mercury" });
    const freeze = getOperationDescriptor("mercury.cards.freeze");
    const accounts = getOperationDescriptor("mercury.accounts.list");
    const accountCards = getOperationDescriptor("mercury.accountCards.list");

    expect(mercuryOperations.map((operation) => operation.operationId)).toContain("mercury.cards.freeze");
    expect(freeze).toMatchObject({
      providerId: "mercury",
      operationId: "mercury.cards.freeze",
      resource: "cards",
      action: "freeze",
      safetyClass: "card_lifecycle",
      executionMode: "dry_run_only",
      liveReadEnabled: false,
      providerSideEffectsEnabled: false,
      requiresOperationPlan: true,
    });
    expect(freeze?.mcp).toMatchObject({ toolName: "banking_card_freeze_request", exposed: true });
    expect(freeze?.cli.providerFirstCommand).toEqual(["mercury", "cards", "freeze"]);
    expect(accounts).toMatchObject({
      executionMode: "implemented_read",
      liveReadEnabled: true,
      providerSideEffectsEnabled: false,
      requiresOperationPlan: false,
    });
    expect(accountCards).toMatchObject({
      executionMode: "conformance_only",
      liveReadEnabled: false,
      providerSideEffectsEnabled: false,
      endpoint: { method: "GET", path: "/api/v1/account/{accountId}/cards" },
      mcp: { exposed: false },
    });
  });

  test("Mercury live execution is limited to the explicit read-only allowlist", () => {
    const mercuryOperations = listOperationDescriptors({ providerId: "mercury", includeUnsupported: true });
    const liveReadOperationIds = mercuryOperations
      .filter((operation) => operation.liveReadEnabled)
      .map((operation) => operation.operationId)
      .sort();

    expect(liveReadOperationIds).toEqual([...MERCURY_LIVE_READ_OPERATION_IDS].sort());
    for (const operation of mercuryOperations) {
      expect(operation.providerSideEffectsEnabled).toBe(false);
      if (!liveReadOperationIds.includes(operation.operationId)) {
        expect(operation.executionMode).not.toBe("implemented_read");
      }
      if (operation.safetyClass !== "read" && operation.support !== "unsupported") {
        expect(operation.requiresOperationPlan).toBe(true);
        expect(operation.executionMode).toBe("dry_run_only");
      }
    }
  });

  test("operation registry maps descriptors to the real CLI command surface", () => {
    expect(getOperationDescriptor("mercury.payments.create")?.cli.command).toEqual(["payments", "request"]);
    expect(getOperationDescriptor("mercury.cards.createVirtual")?.cli.command).toEqual(["cards", "request"]);
    expect(getOperationDescriptor("mercury.cards.updateSettings")?.cli.command).toEqual(["cards", "update"]);
    expect(getOperationDescriptor("mercury.cards.freeze")?.cli.command).toEqual(["cards", "freeze"]);
  });

  test("all provider operations stay non-executable until release gates explicitly verify them", () => {
    for (const contract of listProviderConformanceContracts()) {
      const provider = getProvider(contract.providerId);
      if (!provider) throw new Error(`missing provider ${contract.providerId}`);

      for (const operation of contract.operations) {
        expect(operation.support).not.toBe("verified");
        if (operation.effect === "money_movement" || operation.effect === "card_side_effect") {
          expect(operation.requiresApproval).toBe(true);
          expect(operation.requiresIdempotencyKey).toBe(true);
        }
        if (operation.effect !== "read" && operation.support !== "unsupported") {
          expect(operation.requiresApproval).toBe(true);
        }
        if (operation.operation.startsWith("cards.") && provider.cardOperations.productionOnly) {
          expect(operation.environments).not.toContain("sandbox");
        }
        if (operation.operation.startsWith("cards.") && provider.capabilities.cards === false) {
          expect(operation.support).toBe("unsupported");
        }

        const env = Object.fromEntries(operation.requiredEnv.map((key) => [key, "set"]));
        const plan = planProviderOperation({
          providerId: contract.providerId,
          operation: operation.operation,
          environment: operation.environments[0] ?? "production",
          grantedScopes: operation.requiredScopes,
          env,
        });
        expect(plan.executable).toBe(false);
        const descriptor = getOperationDescriptor(`${contract.providerId}.${operation.operation}`);
        expect(descriptor?.providerSideEffectsEnabled).toBe(false);
        if (operation.support !== "unsupported" && operation.effect !== "read") {
          expect(descriptor?.requiresOperationPlan).toBe(true);
        }
        if (operation.support !== "unsupported") {
          expect(plan.reasons).toContain("Provider operation is not verified for live execution; only conformance planning is allowed.");
        }
      }
    }
  });

  test("all staged adapters remain contract-only with no implemented operations", () => {
    for (const descriptor of listProviderAdapterDescriptors()) {
      expect(descriptor.stage).toBe("contract_only");
      expect(descriptor.liveExecution).toBe(false);
      expect(descriptor.implementedOperations).toEqual([]);

      const adapter = createStagedProviderAdapter(descriptor.providerId);
      for (const operation of descriptor.contract.operations) {
        const plan = adapter.planOperation({
          operation: operation.operation,
          environment: operation.environments[0] ?? "production",
          grantedScopes: operation.requiredScopes,
          env: Object.fromEntries(operation.requiredEnv.map((key) => [key, "set"])),
        });
        expect(plan.executable).toBe(false);
      }
    }
  });
});
