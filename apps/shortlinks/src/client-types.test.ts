// Conformance: the types this package PUBLISHES are the types @hasna/contracts
// actually has.
//
// `./client-types.ts` exists so the emitted declarations are self-contained
// (see the header there — hasna/apps#1782). The risk that buys is DRIFT: a
// hand-written spelling that quietly stops matching the resolver it describes.
// These assertions close it. They are compile-time, so they are checked by
// `bun run typecheck` and by the `tsc --emitDeclarationOnly` step of
// `bun run build` — the same step that produces the declarations they protect.
// A shape that diverges fails the build; it is never published as a lie.
//
// Direction matters and is asserted per type:
//   contracts -> published   for values that come OUT of the resolver and are
//                            handed to a consumer (a resolution, a credential,
//                            the storage client and its transport);
//   published -> contracts   for values a consumer passes IN and this package
//                            forwards to the resolver (chain options, request
//                            options, transport overrides).
// Both directions are asserted where a type crosses in both.
//
// This file lives under src/ deliberately: `tsconfig.json` includes only `src`,
// so an assertion under tests/ would never be type-checked at all.

import { describe, expect, it } from "bun:test";
import type {
  ClientTransportResolution as ContractsClientTransportResolution,
  CredentialChainOptions as ContractsCredentialChainOptions,
  CredentialTier as ContractsCredentialTier,
  HasnaHttpTransport as ContractsHasnaHttpTransport,
  HasnaRequestOptions as ContractsHasnaRequestOptions,
  KeychainCommandResult as ContractsKeychainCommandResult,
  KeychainCommandRunner as ContractsKeychainCommandRunner,
  KeychainTierOptions as ContractsKeychainTierOptions,
  QueryParams as ContractsQueryParams,
  ResolvedCredential as ContractsResolvedCredential,
} from "@hasna/contracts/client";
import type {
  HasnaStorageClient as ContractsHasnaStorageClient,
  StorageListResult as ContractsStorageListResult,
} from "@hasna/contracts/client/storage";
import type {
  ShortlinksClientTransportResolution,
  ShortlinksCredentialChainOptions,
  ShortlinksCredentialTier,
  ShortlinksHttpTransport,
  ShortlinksKeychainCommandResult,
  ShortlinksKeychainCommandRunner,
  ShortlinksKeychainTierOptions,
  ShortlinksKeyStatusResolver,
  ShortlinksQueryParams,
  ShortlinksRequestOptions,
  ShortlinksResolvedCredential,
  ShortlinksStorageClient,
} from "./client-types.js";
import type { KeyStatusResolver as ContractsKeyStatusResolver } from "@hasna/contracts/auth";

/**
 * `A` must be assignable to `B`, or this alias is a compile error at its own
 * declaration. Nothing here is exported, so none of it reaches the emitted
 * declarations.
 */
type AssertAssignable<A extends B, B> = [A, B];

// ── what the resolver hands out: contracts -> published ──────────────────
type _ResolutionOut = AssertAssignable<ContractsClientTransportResolution, ShortlinksClientTransportResolution>;
type _CredentialOut = AssertAssignable<ContractsResolvedCredential, ShortlinksResolvedCredential>;
type _TierOut = AssertAssignable<ContractsCredentialTier, ShortlinksCredentialTier>;
type _TransportOut = AssertAssignable<ContractsHasnaHttpTransport, ShortlinksHttpTransport>;
type _StorageOut = AssertAssignable<ContractsHasnaStorageClient, ShortlinksStorageClient>;
type _ListOut = AssertAssignable<
  ContractsStorageListResult<unknown>,
  ReturnType<ShortlinksStorageClient["list"]> extends Promise<infer R> ? R : never
>;
type _KeychainResultOut = AssertAssignable<ContractsKeychainCommandResult, ShortlinksKeychainCommandResult>;
type _KeyStatusOut = AssertAssignable<ContractsKeyStatusResolver, ShortlinksKeyStatusResolver>;
type _KeyStatusIn = AssertAssignable<ShortlinksKeyStatusResolver, ContractsKeyStatusResolver>;

// ── what a consumer passes in: published -> contracts ────────────────────
type _ChainIn = AssertAssignable<ShortlinksCredentialChainOptions, ContractsCredentialChainOptions>;
type _KeychainIn = AssertAssignable<ShortlinksKeychainTierOptions, ContractsKeychainTierOptions>;
type _RunnerIn = AssertAssignable<ShortlinksKeychainCommandRunner, ContractsKeychainCommandRunner>;
type _RequestIn = AssertAssignable<ShortlinksRequestOptions, ContractsHasnaRequestOptions>;
type _QueryIn = AssertAssignable<ShortlinksQueryParams, ContractsQueryParams>;
type _CredentialIn = AssertAssignable<ShortlinksResolvedCredential, ContractsResolvedCredential>;
type _TierIn = AssertAssignable<ShortlinksCredentialTier, ContractsCredentialTier>;
type _StorageIn = AssertAssignable<ShortlinksStorageClient, ContractsHasnaStorageClient>;
type _TransportIn = AssertAssignable<ShortlinksHttpTransport, ContractsHasnaHttpTransport>;

describe("published @hasna/contracts client types", () => {
  it("is a declaration-only leaf: nothing in it can execute or import", async () => {
    // The one runtime property worth asserting. A type-only module compiles to
    // an empty namespace; the moment somebody adds a const, a class or an
    // import to it, the published declaration graph stops being a leaf and this
    // fails.
    const surface = await import("./client-types.js");
    expect(Object.keys(surface)).toEqual([]);

    const source = await Bun.file(new URL("./client-types.ts", import.meta.url)).text();
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*export\s+(?:const|let|var|function|class)\b/m);
  });
});