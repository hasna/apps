// Conformance: the types this package PUBLISHES via its own declarations are
// the types @hasna/contracts actually has.
//
// `./contracts-types.ts` exists so the emitted declarations are self-contained
// (see the header there): every crossing type is spelled structurally, because
// @hasna/contracts' own `.d.ts` uses extensionless relative imports and any
// strict `nodenext` consumer with `skipLibCheck: false` fails with TS2835 the
// moment a published declaration imports a contracts type. The risk that buys
// is DRIFT: a hand-written spelling that stops matching the contract it
// describes. These assertions close it at compile time — a diverged shape
// fails `tsc` in the same build step that emits the declarations.
//
// Direction matters and is asserted per type:
//   contracts -> published   for values that come OUT of contracts and are
//                            carried by this package's declarations;
//   published -> contracts   for values a consumer passes IN and this package
//                            forwards to contracts.
// Both directions are asserted where a type crosses in both. `ServeApiKeyStore`
// is a deliberate SUBSET of the contracts `ApiKeyStore` class (the members the
// serve names in `ServeDeps`) — only the contracts -> published direction is
// asserted for it.

import { describe, expect, it } from "bun:test";
import type {
  ApiKeyStore as ContractsApiKeyStore,
  ApiKeyVerifier as ContractsApiKeyVerifier,
  ApiKeyPrincipal as ContractsApiKeyPrincipal,
  ApiKeyClaims as ContractsApiKeyClaims,
  ApiKeyStatus as ContractsApiKeyStatus,
  AuthDecision as ContractsAuthDecision,
  AuthDenyReason as ContractsAuthDenyReason,
  ApiKeyAuthContext as ContractsApiKeyAuthContext,
  HeaderSource as ContractsHeaderSource,
  ApiKeyVerifyFailureReason as ContractsApiKeyVerifyFailureReason,
} from "@hasna/contracts/auth";
import type {
  CredentialTier as ContractsCredentialTier,
  KeychainTierOptions as ContractsKeychainTierOptions,
  KeychainCommandResult as ContractsKeychainCommandResult,
  KeychainCommandRunner as ContractsKeychainCommandRunner,
} from "@hasna/contracts/client";
import type {
  HasnaStorageClient as ContractsHasnaStorageClient,
  HasnaHttpTransport as ContractsHasnaHttpTransport,
  HasnaRequestOptions as ContractsHasnaRequestOptions,
  StorageListResult as ContractsStorageListResult,
} from "@hasna/contracts/client/storage";
import type { ProjectPanel as ContractsProjectPanel } from "@hasna/contracts";
import type {
  ApiKeyVerifier,
  ServeApiKeyStore,
  ApiKeyPrincipal,
  ApiKeyClaims,
  ApiKeyStatus,
  AuthDecision,
  AuthDenyReason,
  ApiKeyAuthContext,
  HeaderSource,
  ApiKeyVerifyFailureReason,
  CredentialTier,
  KeychainTierOptions,
  KeychainCommandResult,
  KeychainCommandRunner,
  HasnaStorageClient,
  HasnaHttpTransport,
  HasnaRequestOptions,
  StorageListResult,
  ProjectPanel,
  ProjectPanelProvider,
  ProjectPanelResourceRef,
  ProjectPanelEvidenceRef,
  ProjectPanelItem,
  ProjectPanelMetric,
  ProjectPanelRenderImport,
  ProjectPanelRenderFragment,
  ProjectPanelResourceKind,
  ProjectPanelEvidenceKind,
} from "./contracts-types.js";

/** `A` must be assignable to `B`, or this alias is a compile error. */
type AssertAssignable<A extends B, B> = [A, B];

// ── client seam: credentials ───────────────────────────────────────────────
// Cross both ways: knowledge builds Keychain options and hands them into the
// resolver (published -> contracts) while the transport report and the storage
// client carry contracts values out (contracts -> published).
type _CredentialTierIn = AssertAssignable<CredentialTier, ContractsCredentialTier>;
type _CredentialTierOut = AssertAssignable<ContractsCredentialTier, CredentialTier>;
type _KeychainOut = AssertAssignable<ContractsKeychainTierOptions, KeychainTierOptions>;
type _KeychainIn = AssertAssignable<KeychainTierOptions, ContractsKeychainTierOptions>;
type _ChainResultIn = AssertAssignable<KeychainCommandResult, ContractsKeychainCommandResult>;
type _ChainResultOut = AssertAssignable<ContractsKeychainCommandResult, KeychainCommandResult>;
type _ChainRunnerIn = AssertAssignable<KeychainCommandRunner, ContractsKeychainCommandRunner>;
type _ChainRunnerOut = AssertAssignable<ContractsKeychainCommandRunner, KeychainCommandRunner>;

// ── storage client surface ─────────────────────────────────────────────────
type _StorageOut = AssertAssignable<ContractsHasnaStorageClient, HasnaStorageClient>;
type _StorageIn = AssertAssignable<HasnaStorageClient, ContractsHasnaStorageClient>;
type _TransportOut = AssertAssignable<ContractsHasnaHttpTransport, HasnaHttpTransport>;
type _TransportIn = AssertAssignable<HasnaHttpTransport, ContractsHasnaHttpTransport>;
type _RequestOptsOut = AssertAssignable<ContractsHasnaRequestOptions, HasnaRequestOptions>;
type _RequestOptsIn = AssertAssignable<HasnaRequestOptions, ContractsHasnaRequestOptions>;
type _ListResultOut = AssertAssignable<ContractsStorageListResult<unknown>, StorageListResult<unknown>>;
type _ListResultIn = AssertAssignable<StorageListResult<unknown>, ContractsStorageListResult<unknown>>;

// ── serve API-key surface ──────────────────────────────────────────────────
type _VerifierOut = AssertAssignable<ContractsApiKeyVerifier, ApiKeyVerifier>;
type _VerifierIn = AssertAssignable<ApiKeyVerifier, ContractsApiKeyVerifier>;
type _PrincipalOut = AssertAssignable<ContractsApiKeyPrincipal, ApiKeyPrincipal>;
type _PrincipalIn = AssertAssignable<ApiKeyPrincipal, ContractsApiKeyPrincipal>;
type _ClaimsOut = AssertAssignable<ContractsApiKeyClaims, ApiKeyClaims>;
type _ClaimsIn = AssertAssignable<ApiKeyClaims, ContractsApiKeyClaims>;
type _DecisionOut = AssertAssignable<ContractsAuthDecision, AuthDecision>;
type _DecisionIn = AssertAssignable<AuthDecision, ContractsAuthDecision>;
type _DenyOut = AssertAssignable<ContractsAuthDenyReason, AuthDenyReason>;
type _DenyIn = AssertAssignable<AuthDenyReason, ContractsAuthDenyReason>;
type _CtxOut = AssertAssignable<ContractsApiKeyAuthContext, ApiKeyAuthContext>;
type _CtxIn = AssertAssignable<ApiKeyAuthContext, ContractsApiKeyAuthContext>;
type _HeaderOut = AssertAssignable<ContractsHeaderSource, HeaderSource>;
type _HeaderIn = AssertAssignable<HeaderSource, ContractsHeaderSource>;
type _FailureOut = AssertAssignable<ContractsApiKeyVerifyFailureReason, ApiKeyVerifyFailureReason>;
type _FailureIn = AssertAssignable<ApiKeyVerifyFailureReason, ContractsApiKeyVerifyFailureReason>;
type _StatusOut = AssertAssignable<ContractsApiKeyStatus, ApiKeyStatus>;
type _StatusIn = AssertAssignable<ApiKeyStatus, ContractsApiKeyStatus>;
// A REAL contracts ApiKeyStore satisfies the serve's subset. A serve consumer
// (or this package's own serve) never builds one the other way around.
type _StoreOut = AssertAssignable<ContractsApiKeyStore, ServeApiKeyStore>;

// ── project-panel contract ─────────────────────────────────────────────────
type _PanelOut = AssertAssignable<ContractsProjectPanel, ProjectPanel>;
type _PanelIn = AssertAssignable<ProjectPanel, ContractsProjectPanel>;
type _ProviderIn = AssertAssignable<ProjectPanelProvider, ContractsProjectPanel["provider"]>;
type _ProviderOut = AssertAssignable<ContractsProjectPanel["provider"], ProjectPanelProvider>;
type _ResourceRefIn = AssertAssignable<ProjectPanelResourceRef, ContractsProjectPanel["resourceRefs"][number]>;
type _ResourceRefOut = AssertAssignable<ContractsProjectPanel["resourceRefs"][number], ProjectPanelResourceRef>;
type _EvidenceRefIn = AssertAssignable<ProjectPanelEvidenceRef, ContractsProjectPanel["evidenceRefs"][number]>;
type _EvidenceRefOut = AssertAssignable<ContractsProjectPanel["evidenceRefs"][number], ProjectPanelEvidenceRef>;
type _ItemIn = AssertAssignable<ProjectPanelItem, ContractsProjectPanel["items"][number]>;
type _ItemOut = AssertAssignable<ContractsProjectPanel["items"][number], ProjectPanelItem>;
type _MetricIn = AssertAssignable<ProjectPanelMetric, ContractsProjectPanel["metrics"][number]>;
type _MetricOut = AssertAssignable<ContractsProjectPanel["metrics"][number], ProjectPanelMetric>;
type _ImportIn = AssertAssignable<
  ProjectPanelRenderImport,
  NonNullable<ContractsProjectPanel["renderFragment"]>["imports"][number]
>;
type _ImportOut = AssertAssignable<
  NonNullable<ContractsProjectPanel["renderFragment"]>["imports"][number],
  ProjectPanelRenderImport
>;
type _FragmentIn = AssertAssignable<
  ProjectPanelRenderFragment,
  NonNullable<ContractsProjectPanel["renderFragment"]>
>;
type _FragmentOut = AssertAssignable<
  NonNullable<ContractsProjectPanel["renderFragment"]>,
  ProjectPanelRenderFragment
>;
type _ResourceKind = AssertAssignable<ProjectPanelResourceKind, ContractsProjectPanel["resourceRefs"][number]["kind"]>;
type _EvidenceKind = AssertAssignable<
  ProjectPanelEvidenceKind,
  NonNullable<ContractsProjectPanel["evidenceRefs"][number]["kind"]>
>;

describe("published @hasna/contracts crossing types", () => {
  it("is a declaration-only leaf: nothing in it can execute or import", async () => {
    // A type-only module compiles to an empty namespace; the moment somebody
    // adds a value or an import, the published declaration graph stops being a
    // leaf and this fails.
    const surface = await import("./contracts-types.js");
    expect(Object.keys(surface)).toEqual([]);

    const source = await Bun.file(new URL("./contracts-types.ts", import.meta.url)).text();
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*export\s+(?:const|let|var|function|class)\b/m);
  });
});