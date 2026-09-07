// Conformance: the types this package PUBLISHES are the types @hasna/contracts
// actually has.
//
// `./client-types.ts` exists so the emitted declarations are self-contained
// (see the header there) — strict `nodenext` consumers with `skipLibCheck:
// false` fail on ANY `@hasna/contracts` import in the published `.d.ts`
// (TS2835 in contracts' own distribution). The risk that buys is DRIFT: a
// hand-written spelling that stops matching the contracts declaration it
// describes. These assertions close it — they are compile-time, so they are
// checked by `bun run typecheck` and by the `tsc --emitDeclarationOnly` step
// of `bun run build`, the same step that produces the declarations they
// protect. A shape that diverges fails the build; it is never published as a
// lie.
//
// Direction matters and is asserted per type:
//   contracts -> published   for values that come OUT of contracts and are
//                            carried by this package's own declarations;
//   published -> contracts   for values a consumer passes IN and this package
//                            forwards to the resolver or the schemas.
// Both directions are asserted everywhere the type crosses in both.

import { describe, expect, it, test } from "bun:test";
import type {
  ProjectResourceAuthority as ContractsProjectResourceAuthority,
  ProjectResourceLink as ContractsProjectResourceLink,
  ProjectResourceLinkCollectionV1 as ContractsProjectResourceLinkCollectionV1,
  ProjectResourceLinkInput as ContractsProjectResourceLinkInput,
  ProjectResourceLinkLabels as ContractsProjectResourceLinkLabels,
  ProjectResourceLinkLocator as ContractsProjectResourceLinkLocator,
  ProjectResourceTargetKind as ContractsProjectResourceTargetKind,
} from "@hasna/contracts/schemas";
import type {
  CredentialChainOptions as ContractsCredentialChainOptions,
  CredentialTier as ContractsCredentialTier,
  KeychainCommandResult as ContractsKeychainCommandResult,
  KeychainCommandRunner as ContractsKeychainCommandRunner,
  KeychainTierOptions as ContractsKeychainTierOptions,
  ResolvedCredential as ContractsResolvedCredential,
} from "@hasna/contracts/client";
import type {
  ApiKeyStatus as ContractsApiKeyStatus,
  AuthAuditHook as ContractsAuthAuditHook,
} from "@hasna/contracts/auth";
import type {
  ApiKeyStatus,
  AuthAuditHook,
  CredentialChainOptions,
  CredentialTier,
  KeychainCommandResult,
  KeychainCommandRunner,
  KeychainTierOptions,
  ProjectResourceAuthority,
  ProjectResourceLink,
  ProjectResourceLinkCollectionV1,
  ProjectResourceLinkInput,
  ProjectResourceLinkLabels,
  ProjectResourceLinkLocator,
  ProjectResourceTargetKind,
  ResolvedCredential,
} from "./client-types.js";

/**
 * `A` must be assignable to `B`, or this alias is a compile error at its own
 * declaration. Nothing here is exported, so none of it reaches the emitted
 * declarations.
 */
type AssertAssignable<A extends B, B> = [A, B];

// ── client seam: contracts -> published and published -> contracts ─────────
type _TierOut = AssertAssignable<ContractsCredentialTier, CredentialTier>;
type _TierIn = AssertAssignable<CredentialTier, ContractsCredentialTier>;
type _CredentialOut = AssertAssignable<ContractsResolvedCredential, ResolvedCredential>;
type _CredentialIn = AssertAssignable<ResolvedCredential, ContractsResolvedCredential>;
type _ChainOut = AssertAssignable<ContractsCredentialChainOptions, CredentialChainOptions>;
type _ChainIn = AssertAssignable<CredentialChainOptions, ContractsCredentialChainOptions>;
type _KeychainOut = AssertAssignable<ContractsKeychainTierOptions, KeychainTierOptions>;
type _KeychainIn = AssertAssignable<KeychainTierOptions, ContractsKeychainTierOptions>;
type _ChainResultOut = AssertAssignable<ContractsKeychainCommandResult, KeychainCommandResult>;
type _ChainResultIn = AssertAssignable<KeychainCommandResult, ContractsKeychainCommandResult>;
type _ChainRunnerOut = AssertAssignable<ContractsKeychainCommandRunner, KeychainCommandRunner>;
type _ChainRunnerIn = AssertAssignable<KeychainCommandRunner, ContractsKeychainCommandRunner>;

// ── project-resource links: contracts -> published and published -> contracts
type _AuthorityOut = AssertAssignable<ContractsProjectResourceAuthority, ProjectResourceAuthority>;
type _AuthorityIn = AssertAssignable<ProjectResourceAuthority, ContractsProjectResourceAuthority>;
type _TargetOut = AssertAssignable<ContractsProjectResourceTargetKind, ProjectResourceTargetKind>;
type _TargetIn = AssertAssignable<ProjectResourceTargetKind, ContractsProjectResourceTargetKind>;
type _LabelsOut = AssertAssignable<ContractsProjectResourceLinkLabels, ProjectResourceLinkLabels>;
type _LabelsIn = AssertAssignable<ProjectResourceLinkLabels, ContractsProjectResourceLinkLabels>;
type _LocatorOut = AssertAssignable<ContractsProjectResourceLinkLocator, ProjectResourceLinkLocator>;
type _LocatorIn = AssertAssignable<ProjectResourceLinkLocator, ContractsProjectResourceLinkLocator>;
type _InputOut = AssertAssignable<ContractsProjectResourceLinkInput, ProjectResourceLinkInput>;
type _InputIn = AssertAssignable<ProjectResourceLinkInput, ContractsProjectResourceLinkInput>;
type _LinkOut = AssertAssignable<ContractsProjectResourceLink, ProjectResourceLink>;
type _LinkIn = AssertAssignable<ProjectResourceLink, ContractsProjectResourceLink>;
type _CollectionOut = AssertAssignable<ContractsProjectResourceLinkCollectionV1, ProjectResourceLinkCollectionV1>;
type _CollectionIn = AssertAssignable<ProjectResourceLinkCollectionV1, ContractsProjectResourceLinkCollectionV1>;

// ── serve auth surface: both directions ────────────────────────────────────
type _StatusOut = AssertAssignable<ContractsApiKeyStatus, ApiKeyStatus>;
type _StatusIn = AssertAssignable<ApiKeyStatus, ContractsApiKeyStatus>;
type _HookOut = AssertAssignable<ContractsAuthAuditHook, AuthAuditHook>;
type _HookIn = AssertAssignable<AuthAuditHook, ContractsAuthAuditHook>;

describe("published @hasna/contracts crossing types", () => {
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

  // Runtime identity of the re-typed root schema exports (project-resource
  // schemas): the VALUES are the very contracts objects — only the published
  // type annotation is local. Asserting identity means a future "optimization"
  // that copies the schemas can never drift validation behavior.
  test("root schema re-exports ARE the @hasna/contracts objects", async () => {
    const local = await import("./project-resource-schemas.js");
    const contracts = await import("@hasna/contracts/schemas");
    for (const name of [
      "ProjectResourceAuthoritySchema",
      "ProjectResourceTargetKindSchema",
      "ProjectResourceLinkLabelsSchema",
      "ProjectResourceLinkLocatorSchema",
      "ProjectResourceLinkInputSchema",
      "ProjectResourceLinkSchema",
      "ProjectResourceLinkCollectionV1Schema",
    ]) {
      expect((local as Record<string, unknown>)[name]).toBe((contracts as Record<string, unknown>)[name]);
    }
  });
});