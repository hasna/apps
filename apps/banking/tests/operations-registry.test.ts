/**
 * TEST-GAP suite: operation registry and provider parsing edges.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * tests/provider-contracts.test.ts and tests/cli.test.ts cover descriptor
 * mapping for known operations but never the fail-closed parsing paths
 * (missing/unknown provider and environment) or the registry-wide
 * invariants every descriptor must satisfy.
 */
import { describe, expect, test } from "bun:test";
import {
  getOperationDescriptor,
  isProviderId,
  listOperationDescriptors,
  listProviderIds,
  parseProviderEnvironment,
  parseProviderId,
  requireOperationDescriptor,
} from "../src/index.ts";

describe("provider id and environment parsing", () => {
  test("parseProviderId accepts known providers and rejects unknown ones", () => {
    expect(parseProviderId("mercury")).toBe("mercury");
    expect(parseProviderId("erste-bcr")).toBe("erste-bcr");
    expect(() => parseProviderId("nope")).toThrow("Unknown provider: nope");
    expect(() => parseProviderId(undefined)).toThrow("Missing required --provider value.");
  });

  test("parseProviderEnvironment accepts only sandbox and production", () => {
    expect(parseProviderEnvironment("sandbox")).toBe("sandbox");
    expect(parseProviderEnvironment("production")).toBe("production");
    expect(() => parseProviderEnvironment("staging")).toThrow("Unknown environment: staging");
    expect(() => parseProviderEnvironment(undefined)).toThrow("Missing required --environment value.");
  });

  test("isProviderId and listProviderIds stay in lockstep with the registry", () => {
    const ids = listProviderIds();
    expect(ids).toEqual(["mercury", "bunq", "revolut-business", "erste-bcr"]);
    for (const id of ids) expect(isProviderId(id)).toBe(true);
    expect(isProviderId("nope")).toBe(false);
  });
});

describe("operation descriptor lookup", () => {
  test("unknown operations and providers resolve to undefined", () => {
    expect(getOperationDescriptor("mercury.nope")).toBeUndefined();
    expect(getOperationDescriptor("nope.accounts.list")).toBeUndefined();
    expect(getOperationDescriptor("")).toBeUndefined();
  });

  test("requireOperationDescriptor fails closed on unknown operations", () => {
    expect(() => requireOperationDescriptor("mercury.nope")).toThrow("Unknown operation: mercury.nope");
  });

  test("listOperationDescriptors filters by provider and safety class", () => {
    const mercuryOnly = listOperationDescriptors({ providerId: "mercury" });
    expect(mercuryOnly.length).toBeGreaterThan(0);
    expect(mercuryOnly.every((descriptor) => descriptor.providerId === "mercury")).toBe(true);

    const reads = listOperationDescriptors({ safetyClass: "read" });
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((descriptor) => descriptor.safetyClass === "read")).toBe(true);

    const withoutUnsupported = listOperationDescriptors();
    const withUnsupported = listOperationDescriptors({ includeUnsupported: true });
    expect(withUnsupported.length).toBeGreaterThan(withoutUnsupported.length);
  });
});

describe("registry-wide descriptor invariants", () => {
  test("no descriptor ever enables provider side effects", () => {
    const descriptors = listOperationDescriptors({ includeUnsupported: true });
    expect(descriptors.length).toBeGreaterThan(100);
    expect(descriptors.every((descriptor) => descriptor.providerSideEffectsEnabled === false)).toBe(true);
  });

  test("every descriptor's CLI surface is prefixed with its provider id", () => {
    const descriptors = listOperationDescriptors({ includeUnsupported: true });
    for (const descriptor of descriptors) {
      expect(descriptor.cli.providerFirstCommand[0]).toBe(descriptor.providerId);
      expect(descriptor.cli.command.length).toBeGreaterThan(0);
    }
  });

  test("only the four documented Mercury reads are live-enabled", () => {
    const liveReads = listOperationDescriptors({ includeUnsupported: true })
      .filter((descriptor) => descriptor.liveReadEnabled)
      .map((descriptor) => descriptor.operationId);
    expect(liveReads).toEqual([
      "mercury.accounts.list",
      "mercury.balances.get",
      "mercury.cards.list",
      "mercury.transactions.list",
    ]);
  });

  test("unsupported descriptors are never implemented reads or MCP-exposed", () => {
    const unsupported = listOperationDescriptors({ includeUnsupported: true })
      .filter((descriptor) => descriptor.support === "unsupported");
    expect(unsupported.length).toBeGreaterThan(0);
    for (const descriptor of unsupported) {
      expect(descriptor.liveReadEnabled).toBe(false);
      expect(descriptor.mcp.exposed).toBe(false);
      expect(descriptor.cli.implemented).toBe(false);
    }
  });

  test("every operation descriptor carries non-empty release gates", () => {
    const descriptors = listOperationDescriptors({ includeUnsupported: true });
    for (const descriptor of descriptors) {
      expect(descriptor.releaseGates.length).toBeGreaterThan(0);
    }
  });
});
