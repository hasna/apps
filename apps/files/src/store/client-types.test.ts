import { describe, expect, test } from "bun:test";
import type {
  CredentialChainOptions,
  KeychainCommandRunner,
  KeychainTierOptions,
  ResolvedCredential,
} from "@hasna/contracts/client";
import type { HasnaStorageClient, resolveStorageClient } from "@hasna/contracts/client/storage";
import type {
  FilesCredentialChainOptions,
  FilesKeychainCommandRunner,
  FilesKeychainOptions,
  FilesResolvedCredential,
  FilesStorageClient,
  FilesStorageOverrides,
} from "./client-types.js";

/**
 * Pins the locally-spelled typing leaf (`./client-types.ts`) to the real
 * @hasna/contracts declarations it mirrors, in BOTH directions.
 *
 * `@hasna/contracts` is a BUILD-TIME dependency — every bundle inlines it — so
 * the `.d.ts` `tsc` emits must never import it (#1782). The published boundary
 * types are therefore re-spelled locally with NO imports; this file is where a
 * drift between the two spellings fails the build: if the resolver grows or
 * narrows a shape, the assertions below stop compiling and the spelling must be
 * updated to match, never silently left behind.
 */

type AssertExtends<A, B> = A extends B ? true : false;
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("client-types spelling parity (@hasna/contracts 1.0.2)", () => {
  test("FilesCredentialChainOptions mirrors CredentialChainOptions", () => {
    type A = AssertExtends<FilesCredentialChainOptions, CredentialChainOptions>;
    type B = AssertExtends<CredentialChainOptions, FilesCredentialChainOptions>;
    const a: A = true;
    const b: B = true;
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  test("FilesKeychainOptions mirrors KeychainTierOptions", () => {
    type A = AssertExtends<FilesKeychainOptions, KeychainTierOptions>;
    type B = AssertExtends<KeychainTierOptions, FilesKeychainOptions>;
    expect<A>(true).toBe(true);
    expect<B>(true).toBe(true);
  });

  test("FilesKeychainCommandRunner mirrors KeychainCommandRunner", () => {
    type A = AssertExtends<FilesKeychainCommandRunner, KeychainCommandRunner>;
    type B = AssertExtends<KeychainCommandRunner, FilesKeychainCommandRunner>;
    expect<A>(true).toBe(true);
    expect<B>(true).toBe(true);
  });

  test("FilesResolvedCredential mirrors ResolvedCredential", () => {
    type A = AssertExtends<FilesResolvedCredential, ResolvedCredential>;
    type B = AssertExtends<ResolvedCredential, FilesResolvedCredential>;
    expect<A>(true).toBe(true);
    expect<B>(true).toBe(true);
  });

  test("FilesStorageClient is satisfied by HasnaStorageClient", () => {
    // Direction that matters at the seam: the resolver's client value must be
    // assignable to the locally-published shape.
    type A = AssertExtends<HasnaStorageClient, FilesStorageClient>;
    type Equal = AssertEqual<HasnaStorageClient, FilesStorageClient>;
    expect<A>(true).toBe(true);
    expect<Equal>(true).toBe(true);
  });

  test("FilesStorageOverrides mirrors the contracts resolveStorageClient options", () => {
    type ContractsOverrides = Parameters<typeof resolveStorageClient>[2];
    type A = AssertExtends<FilesStorageOverrides, ContractsOverrides>;
    type B = AssertExtends<ContractsOverrides, FilesStorageOverrides>;
    expect<A>(true).toBe(true);
    expect<B>(true).toBe(true);
  });
});