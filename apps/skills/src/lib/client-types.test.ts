// Conformance: the types this package PUBLISHES are the types @hasna/contracts
// actually has.
//
// `./client-types.ts` exists so the emitted declarations are self-contained
// (see the header there). The risk that buys is DRIFT: a hand-written spelling
// that quietly stops matching the resolver it describes. These assertions close
// it. They are compile-time, so they are checked by `bun run typecheck` and by
// the `tsc --emitDeclarationOnly` step of `bun run build` — the same step that
// produces the declarations they protect. A shape that diverges fails the
// build; it is never published as a lie.
//
// Direction matters and is asserted per type:
//   contracts -> published   for values that come OUT of the resolver and are
//                            carried by this package's own declarations (a
//                            resolution, a tier, the resolved key);
//   published -> contracts   for values a consumer passes IN and this package
//                            forwards to the resolver (chain options, Keychain
//                            controls).
// Both directions are asserted where a type crosses in both.

import { describe, expect, it } from "bun:test";
import type {
  CredentialChainOptions as ContractsCredentialChainOptions,
  CredentialTier as ContractsCredentialTier,
  KeychainCommandResult as ContractsKeychainCommandResult,
  KeychainCommandRunner as ContractsKeychainCommandRunner,
  KeychainTierOptions as ContractsKeychainTierOptions,
  ResolvedCredential as ContractsResolvedCredential,
} from "@hasna/contracts/client";
import type {
  CredentialChainOptions,
  CredentialTier,
  KeychainCommandResult,
  KeychainCommandRunner,
  KeychainTierOptions,
  ResolvedCredential,
} from "./client-types.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * `A` must be assignable to `B`, or this alias is a compile error at its own
 * declaration. Nothing here is exported, so none of it reaches the emitted
 * declarations.
 */
type AssertAssignable<A extends B, B> = [A, B];

// ── what the resolver hands out: contracts -> published ──────────────────
type _TierOut = AssertAssignable<ContractsCredentialTier, CredentialTier>;
type _CredentialOut = AssertAssignable<ContractsResolvedCredential, ResolvedCredential>;
type _KeychainResultOut = AssertAssignable<ContractsKeychainCommandResult, KeychainCommandResult>;

// ── what a consumer passes in: published -> contracts ────────────────────
type _ChainIn = AssertAssignable<CredentialChainOptions, ContractsCredentialChainOptions>;
type _KeychainIn = AssertAssignable<KeychainTierOptions, ContractsKeychainTierOptions>;
type _RunnerIn = AssertAssignable<KeychainCommandRunner, ContractsKeychainCommandRunner>;
type _TierIn = AssertAssignable<CredentialTier, ContractsCredentialTier>;
type _CredentialIn = AssertAssignable<ResolvedCredential, ContractsResolvedCredential>;

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