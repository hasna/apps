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
import { z } from "zod";
import {
  ProjectResourceAuthoritySchema as ContractsProjectResourceAuthoritySchema,
  ProjectResourceLinkCollectionV1Schema as ContractsProjectResourceLinkCollectionV1Schema,
  ProjectResourceLinkInputSchema as ContractsProjectResourceLinkInputSchema,
  ProjectResourceLinkLabelsSchema as ContractsProjectResourceLinkLabelsSchema,
  ProjectResourceLinkLocatorSchema as ContractsProjectResourceLinkLocatorSchema,
  ProjectResourceLinkSchema as ContractsProjectResourceLinkSchema,
  ProjectResourceTargetKindSchema as ContractsProjectResourceTargetKindSchema,
} from "@hasna/contracts/schemas";
import {
  ProjectResourceAuthoritySchema,
  ProjectResourceLinkCollectionV1Schema,
  ProjectResourceLinkInputSchema,
  ProjectResourceLinkLabelsSchema,
  ProjectResourceLinkLocatorSchema,
  ProjectResourceLinkSchema,
  ProjectResourceTargetKindSchema,
} from "./project-resource-schemas.js";
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

// ── the seven root schema re-exports: input/output fidelity ────────────────
// `project-resource-schemas.ts` re-states each contracts schema through the
// local output spellings. For five of them that re-statement is
// `z.ZodType<Output>`, which deliberately DROPS the concrete zod member API
// (`.shape`, `.extend()`, `.pick()`, `.partial()`, `.keyof()`, `.options`,
// `.discriminator()`, `.innerType()`, `.sourceType()`) from the published
// type — a documented breaking type change, recorded in
// `.changeset/1720-seam-projects-contract-free-dts.md`. What must NOT drift is
// the schemas' INPUT and OUTPUT types: they are the published
// `.parse()`/`.safeParse()` contract and what consumer generics read. The
// `AssertAssignable` block above pins only the inferred OUTPUT types of the
// plain type aliases; these assertions pin `z.input`/`z.output` of the schema
// VALUES, in both directions, so a local spelling that stops matching the
// contracts schema fails the same build that emits the declarations.
// NOTE: these are spelled flat, per schema and per direction, on purpose. A
// generic helper (`type Io<S extends z.ZodTypeAny, T extends z.ZodTypeAny> =
// AssertAssignable<z.input<S>, z.input<T>>`) is VACUOUS: the constraint is
// checked against the deferred `z.input<S>`/`z.input<T>` and never re-checked
// once S and T are substituted, so a drifted schema annotation type-checks
// clean. Measured on this file: with the labels schema's input parameter
// drifted to `ProjectResourceLinkLabels | undefined`, the generic form passed
// `tsc --noEmit` while the flat form below fails. Keep it flat.
type ContractsAuthoritySchema = typeof ContractsProjectResourceAuthoritySchema;
type LocalAuthoritySchema = typeof ProjectResourceAuthoritySchema;
type ContractsTargetKindSchema = typeof ContractsProjectResourceTargetKindSchema;
type LocalTargetKindSchema = typeof ProjectResourceTargetKindSchema;
type ContractsLabelsSchema = typeof ContractsProjectResourceLinkLabelsSchema;
type LocalLabelsSchema = typeof ProjectResourceLinkLabelsSchema;
type ContractsLocatorSchema = typeof ContractsProjectResourceLinkLocatorSchema;
type LocalLocatorSchema = typeof ProjectResourceLinkLocatorSchema;
type ContractsInputSchema = typeof ContractsProjectResourceLinkInputSchema;
type LocalInputSchema = typeof ProjectResourceLinkInputSchema;
type ContractsLinkSchema = typeof ContractsProjectResourceLinkSchema;
type LocalLinkSchema = typeof ProjectResourceLinkSchema;
type ContractsCollectionSchema = typeof ContractsProjectResourceLinkCollectionV1Schema;
type LocalCollectionSchema = typeof ProjectResourceLinkCollectionV1Schema;

type _IoAuthorityIn = AssertAssignable<z.input<ContractsAuthoritySchema>, z.input<LocalAuthoritySchema>>;
type _IoAuthorityInBack = AssertAssignable<z.input<LocalAuthoritySchema>, z.input<ContractsAuthoritySchema>>;
type _IoAuthorityOut = AssertAssignable<z.output<ContractsAuthoritySchema>, z.output<LocalAuthoritySchema>>;
type _IoAuthorityOutBack = AssertAssignable<z.output<LocalAuthoritySchema>, z.output<ContractsAuthoritySchema>>;
type _IoTargetKindIn = AssertAssignable<z.input<ContractsTargetKindSchema>, z.input<LocalTargetKindSchema>>;
type _IoTargetKindInBack = AssertAssignable<z.input<LocalTargetKindSchema>, z.input<ContractsTargetKindSchema>>;
type _IoTargetKindOut = AssertAssignable<z.output<ContractsTargetKindSchema>, z.output<LocalTargetKindSchema>>;
type _IoTargetKindOutBack = AssertAssignable<z.output<LocalTargetKindSchema>, z.output<ContractsTargetKindSchema>>;
type _IoLabelsIn = AssertAssignable<z.input<ContractsLabelsSchema>, z.input<LocalLabelsSchema>>;
type _IoLabelsInBack = AssertAssignable<z.input<LocalLabelsSchema>, z.input<ContractsLabelsSchema>>;
type _IoLabelsOut = AssertAssignable<z.output<ContractsLabelsSchema>, z.output<LocalLabelsSchema>>;
type _IoLabelsOutBack = AssertAssignable<z.output<LocalLabelsSchema>, z.output<ContractsLabelsSchema>>;
type _IoLocatorIn = AssertAssignable<z.input<ContractsLocatorSchema>, z.input<LocalLocatorSchema>>;
type _IoLocatorInBack = AssertAssignable<z.input<LocalLocatorSchema>, z.input<ContractsLocatorSchema>>;
type _IoLocatorOut = AssertAssignable<z.output<ContractsLocatorSchema>, z.output<LocalLocatorSchema>>;
type _IoLocatorOutBack = AssertAssignable<z.output<LocalLocatorSchema>, z.output<ContractsLocatorSchema>>;
type _IoInputIn = AssertAssignable<z.input<ContractsInputSchema>, z.input<LocalInputSchema>>;
type _IoInputInBack = AssertAssignable<z.input<LocalInputSchema>, z.input<ContractsInputSchema>>;
type _IoInputOut = AssertAssignable<z.output<ContractsInputSchema>, z.output<LocalInputSchema>>;
type _IoInputOutBack = AssertAssignable<z.output<LocalInputSchema>, z.output<ContractsInputSchema>>;
type _IoLinkIn = AssertAssignable<z.input<ContractsLinkSchema>, z.input<LocalLinkSchema>>;
type _IoLinkInBack = AssertAssignable<z.input<LocalLinkSchema>, z.input<ContractsLinkSchema>>;
type _IoLinkOut = AssertAssignable<z.output<ContractsLinkSchema>, z.output<LocalLinkSchema>>;
type _IoLinkOutBack = AssertAssignable<z.output<LocalLinkSchema>, z.output<ContractsLinkSchema>>;
type _IoCollectionIn = AssertAssignable<z.input<ContractsCollectionSchema>, z.input<LocalCollectionSchema>>;
type _IoCollectionInBack = AssertAssignable<z.input<LocalCollectionSchema>, z.input<ContractsCollectionSchema>>;
type _IoCollectionOut = AssertAssignable<z.output<ContractsCollectionSchema>, z.output<LocalCollectionSchema>>;
type _IoCollectionOutBack = AssertAssignable<z.output<LocalCollectionSchema>, z.output<ContractsCollectionSchema>>;

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