import { describe, expect, test } from "bun:test";
import {
  createStagedProviderAdapter,
  getProviderConformanceContract,
  getProvider,
  listProviderAdapterDescriptors,
  listProviderConformanceContracts,
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
      env: { MERCURY_API_TOKEN: "set" },
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
      env: { ERSTE_CLIENT_ID: "set" },
    });
    const payment = contract?.operations.find((candidate) => candidate.operation === "payments.create");

    expect(payment?.requiresSCA).toBe(true);
    expect(payment?.requiredScopes).toEqual(["PIS"]);
    expect(cardPlan.status).toBe("blocked");
    expect(cardPlan.reasons).toContain("Provider contract marks operation unsupported.");
  });

  test("staged adapters expose plan-only descriptors with no live execution", () => {
    const descriptors = listProviderAdapterDescriptors();
    const adapter = createStagedProviderAdapter("mercury");
    const plan = adapter.planOperation({
      operation: "payments.create",
      environment: "sandbox",
      grantedScopes: ["transactions:write"],
      env: { MERCURY_API_TOKEN: "set" },
    });

    expect(descriptors).toHaveLength(4);
    expect(descriptors.every((descriptor) => descriptor.stage === "contract_only")).toBe(true);
    expect(descriptors.every((descriptor) => descriptor.liveExecution === false)).toBe(true);
    expect(descriptors.every((descriptor) => descriptor.implementedOperations.length === 0)).toBe(true);
    expect(adapter.descriptor.plannedOperations).toContain("payments.create");
    expect(plan.status).toBe("ready_for_conformance");
    expect(plan.executable).toBe(false);
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
