// The locally-published spellings match the real @hasna/contracts types, in
// both directions (hasna/apps#1782). A drift fails this file, not a consumer's
// install: the app's bundles inline the resolver (devDependency), while the
// emitted declarations carry only the local spellings from ./client-types.ts.
import { describe, expect, test } from "bun:test";
import type { CredentialChainOptions, KeychainTierOptions, KeychainCommandResult } from "@hasna/contracts/client";
import type { HasnaRequestOptions, HasnaHttpTransport } from "@hasna/contracts/client";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type {
  InstructionsClientEnv,
  InstructionsCredentialChainOptions,
  InstructionsKeychainOptions,
  InstructionsRequestOptions,
  InstructionsStorageClient,
  InstructionsStorageTransport,
} from "./client-types.js";

/** The contracts `Env` spelling (record-of-string-or-undefined; not re-exported publicly). */
type ContractsEnv = Record<string, string | undefined>;

describe("client-type spellings match the published @hasna/contracts shapes", () => {
  test("the env spelling is the contracts Env", () => {
    const check: (env: InstructionsClientEnv) => ContractsEnv = (env) => env;
    const check2: (env: ContractsEnv) => InstructionsClientEnv = (env) => env;
    expect(typeof check).toBe("function");
    expect(typeof check2).toBe("function");
  });

  test("the keychain options spelling is the contracts KeychainTierOptions", () => {
    const check: (options: InstructionsKeychainOptions) => KeychainTierOptions = (options) => options;
    const check2: (options: KeychainTierOptions) => InstructionsKeychainOptions = (options) => options;
    expect(typeof check).toBe("function");
    expect(typeof check2).toBe("function");
  });

  test("the credential chain spelling is the contracts CredentialChainOptions", () => {
    const check: (options: InstructionsCredentialChainOptions) => CredentialChainOptions = (options) => options;
    const check2: (options: CredentialChainOptions) => InstructionsCredentialChainOptions = (options) => options;
    expect(typeof check).toBe("function");
    expect(typeof check2).toBe("function");
  });

  test("the keychain runner result spelling is the contracts KeychainCommandResult", () => {
    type LocalRunResult = NonNullable<InstructionsKeychainOptions["run"]> extends (argv: readonly string[]) => infer R ? R : never;
    const local: LocalRunResult = { status: 0, stdout: "", stderr: "" };
    const contracts: KeychainCommandResult = local; // local -> contracts
    const back: LocalRunResult = contracts; // contracts -> local
    expect(back.status).toBe(0);
  });

  test("the request options spelling is a structural superset of HasnaRequestOptions", () => {
    const check: (options: HasnaRequestOptions) => InstructionsRequestOptions = (options) => options;
    expect(typeof check).toBe("function");
    // And the narrower spelling can be handed to the real transport (the store
    // forwards exactly the fields it spells).
    const check2: (options: InstructionsRequestOptions) => HasnaRequestOptions = (options) => options;
    expect(typeof check2).toBe("function");
  });

  test("the transport spelling is the contracts HasnaHttpTransport", () => {
    const check: (transport: HasnaHttpTransport) => InstructionsStorageTransport = (transport) => transport;
    const check2: (transport: InstructionsStorageTransport) => HasnaHttpTransport = (transport) => transport;
    expect(typeof check).toBe("function");
    expect(typeof check2).toBe("function");
  });

  test("the storage client spelling is the contracts HasnaStorageClient", () => {
    const check: (client: HasnaStorageClient) => InstructionsStorageClient = (client) => client;
    const check2: (client: InstructionsStorageClient) => HasnaStorageClient = (client) => client;
    expect(typeof check).toBe("function");
    expect(typeof check2).toBe("function");
  });
});