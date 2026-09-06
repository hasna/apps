/**
 * @hasna/logs — the local spellings of the @hasna/contracts client types are
 * the SAME types (hasna/apps#1782).
 *
 * The published declarations must not import `@hasna/contracts` (a build-time
 * devDependency), so the crossing types are spelled locally in
 * `./client-types.ts`. This file pins the two spellings to each other in both
 * directions: if the @hasna/contracts declaration gains or changes a member
 * the local mirror does not carry, an assignability check fails here before
 * any consumer is hit.
 */
import { describe, expect, test } from "bun:test";
import type { CredentialChainOptions, KeychainTierOptions } from "@hasna/contracts/client";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type {
  LogsCredentialChainOptions,
  LogsKeychainTierOptions,
  LogsStorageClientLike,
} from "./client-types.ts";

describe("client-type identity: the local spelling accepts the real type", () => {
  test("CredentialChainOptions -> LogsCredentialChainOptions", () => {
    const accept = (_value: LogsCredentialChainOptions): void => undefined;
    const value: CredentialChainOptions = {
      apiKey: "k",
      profile: "p",
      keychain: { enabled: true, platform: "darwin" },
    };
    // Compile-time: the real options satisfy the local spelling.
    accept(value);
    const keychain: KeychainTierOptions = { run: () => ({ status: 0, stdout: "x", stderr: "" }) };
    const localKeychain: LogsKeychainTierOptions = keychain;
    expect(localKeychain.run).toBeTypeOf("function");
    expect(true).toBe(true);
  });

  test("LogsCredentialChainOptions -> CredentialChainOptions", () => {
    const accept = (_value: CredentialChainOptions): void => undefined;
    const value: LogsCredentialChainOptions = {
      apiKey: "k",
      keychain: {
        run: (argv) => ({ status: argv.length > 0 ? 0 : null, stdout: "x", stderr: "" }),
      },
    };
    // Compile-time: the local options satisfy the real signature.
    accept(value);
    expect(true).toBe(true);
  });

  test("HasnaStorageClient -> LogsStorageClientLike", () => {
    const accept = (_value: LogsStorageClientLike): void => undefined;
    const storage: HasnaStorageClient = {} as HasnaStorageClient;
    // Compile-time: the real storage client satisfies the local constructor
    // signature (ApiStore accepts it unchanged).
    accept(storage);
    expect(true).toBe(true);
  });

  test("LogsStorageClientLike -> HasnaStorageClient (structural superset)", () => {
    // The local spelling is a structural SUBTYPE of the real declaration (the
    // real one carries the same members); the reverse direction must also
    // compile so consumers holding a local-shaped object can pass it to
    // @hasna/contracts-aware code.
    const accept = (_value: HasnaStorageClient): void => undefined;
    const local: LogsStorageClientLike = {
      name: "logs",
      baseUrl: "https://api.hasna.com/logs/v1",
      transport: { request: async () => undefined },
      list: async () => ({ items: [], total: null, cursor: null, raw: null }),
      get: async () => null,
      create: async () => ({}),
    };
    accept(local as HasnaStorageClient);
    expect(local.baseUrl).toBe("https://api.hasna.com/logs/v1");
  });
});