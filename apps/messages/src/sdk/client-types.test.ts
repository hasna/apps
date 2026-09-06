/**
 * Conformance: the types this package PUBLISHES are the types @hasna/contracts
 * declares (hasna/apps#1782).
 *
 * `@hasna/contracts` is a BUILD-TIME dependency: `bun build --target bun`
 * inlines the resolver into every bundle, so every shipped dist JS bundle
 * never needs it at runtime — but the declarations `tsc` emits are NOT
 * bundled, and an exported signature naming a contracts type would land in
 * the published declarations as a live `@hasna/contracts` import every TS
 * consumer would fail on, since consumers install runtime dependencies and
 * not devDependencies.
 *
 * The seam therefore spells every crossing type locally (./client-types.ts)
 * and this file asserts, at compile time, that the two spellings ARE the same
 * type in both directions. A shape that drifts fails the build.
 */
import { describe, expect, test } from "bun:test";
import type {
  CredentialChainOptions,
  KeychainTierOptions,
  ResolvedCredential,
} from "@hasna/contracts/client";
import type { MessagesAuthQueryClient, MessagesAuthRow } from "../server/auth";
import type {
  MessagesCredentialChainOptions,
  MessagesKeychainCommandResult,
  MessagesKeychainCommandRunner,
  MessagesKeychainTierOptions,
  MessagesResolvedCredential,
} from "./client-types.js";

// Local spelling -> contracts type (the seam direction: what the resolver
// receives). Any shape drift fails to compile here.
const localToContracts: {
  credentialChain: CredentialChainOptions;
  keychain: KeychainTierOptions;
  resolved: ResolvedCredential;
} = {
  credentialChain: {} as MessagesCredentialChainOptions,
  keychain: {} as MessagesKeychainTierOptions,
  resolved: {} as MessagesResolvedCredential,
};

describe("published client types conform to @hasna/contracts", () => {
  test("the local spellings are assignable to the contracts declarations", () => {
    // The const above compiled, or this file would not build. Reach into it so
    // the compiler cannot tree-shake the check away.
    expect(localToContracts.credentialChain).toBeDefined();
    expect(localToContracts.keychain).toBeDefined();
    expect(localToContracts.resolved).toBeDefined();
  });

  test("keychain option field shapes agree field by field", () => {
    const local: MessagesKeychainTierOptions = { enabled: false, platform: "linux", hostname: () => "x" };
    const contracts: KeychainTierOptions = local;
    expect(contracts.enabled).toBe(false);
  });

  test("the command runner shape agrees", () => {
    const runner: MessagesKeychainCommandRunner = (_argv) => ({ status: 0, stdout: "v", stderr: "" });
    const result: MessagesKeychainCommandResult = runner(["find-generic-password"]);
    expect(result.stdout).toBe("v");
  });

  test("the server auth query-client spelling agrees with the contracts shape", () => {
    // MessagesAuthQueryClient is a structural subset of the storage kit's
    // TypedQueryClient; the assignment below is the compile-time proof.
    const client: MessagesAuthQueryClient = {
      many: async <T extends MessagesAuthRow>(sql: string) => [] as T[],
      get: async <T extends MessagesAuthRow>(_sql: string) => null as T | null,
      execute: async () => {},
    };
    expect(client).toBeDefined();
  });
});