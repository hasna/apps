/**
 * The @hasna/contracts types that cross this package's published boundary,
 * spelled structurally — locally.
 *
 * WHY THIS FILE EXISTS. `@hasna/contracts` is a runtime dependency here, but
 * its DISTRIBUTION is not strict-consumer-safe: its `.d.ts` files use
 * extensionless relative imports, so a consumer that type-checks with
 * `moduleResolution: nodenext` + `skipLibCheck: false` fails with TS2835 as
 * soon as a `@hasna/projects` declaration imports a contracts type. The
 * emitted `.d.ts` therefore spells every crossing type structurally, HERE.
 * The sibling `client-types.test.ts` asserts each one is mutually assignable
 * with the real contracts declaration, in every direction it crosses, so a
 * drifted shape fails `tsc` in the same build step that emits the
 * declarations it protects (hasna/apps#1782, adversarial credential-seam
 * audit).
 *
 * This file is NOT the vendored resolver: it has no imports, no runtime
 * statement — only the shapes, copied from the @hasna/contracts@1.0.2
 * declarations. Source files keep importing the resolver and its VALUES from
 * @hasna/contracts at runtime; only the types they name in public signatures
 * come from here.
 *
 * Do not add an import. Do not add a value. This file must stay a leaf.
 */

// ── @hasna/contracts/client — the client seam ───────────────────────────────

/** Which link of the credential chain supplied the key. */
export type CredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

export interface ResolvedCredential {
  readonly apiKey: string;
  readonly tier: CredentialTier;
  readonly source: string;
  readonly deliberate: boolean;
  readonly pointerVaultKey?: string;
  readonly diskCandidates: readonly string[];
  readonly warning: string | null;
}

/** The captured outcome of one `security` invocation. `stdout` IS the secret. */
export interface KeychainCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type KeychainCommandRunner = (argv: readonly string[]) => KeychainCommandResult;

/** Tier 3 controls. Every field is optional; production callers pass nothing. */
export interface KeychainTierOptions {
  enabled?: boolean;
  platform?: string;
  hostname?: () => string;
  run?: KeychainCommandRunner;
}

export interface CredentialChainOptions {
  apiKey?: string;
  profile?: string;
  keychain?: KeychainTierOptions;
}

// ── @hasna/contracts/schemas — project-resource links ───────────────────────

export type ProjectResourceAuthority = "todos" | "conversations" | "knowledge" | "mementos" | "orgs" | "contacts";

export type ProjectResourceTargetKind =
  | "contact"
  | "org"
  | "project"
  | "task"
  | "task_list"
  | "plan"
  | "channel"
  | "collection"
  | "item";

export interface ProjectResourceLinkLabels {
  name?: string | undefined;
  path?: string | undefined;
  tags?: string[] | undefined;
  channel_name?: string | undefined;
}

export type ProjectResourceLinkLocator =
  | { kind: "external_uuid"; value: string }
  | { kind: "canonical_uri"; value: string }
  | { kind: "conversations_channel_id"; value: string };

export type ProjectResourceLinkExternalUuidLocator = Extract<ProjectResourceLinkLocator, { kind: "external_uuid" }>;

/** Fields every link input carries, whichever authority it targets. */
export interface ProjectResourceLinkInputBase {
  scope: "collection" | "resource";
  service_instance: string;
  labels?: ProjectResourceLinkLabels | undefined;
}

export type ProjectResourceLinkInput =
  | (ProjectResourceLinkInputBase & {
      source_package: "@hasna/todos";
      authority: "todos";
      target_kind: "project" | "task_list" | "plan";
      locator: { kind: "external_uuid"; value: string } | { kind: "canonical_uri"; value: string };
    })
  | (ProjectResourceLinkInputBase & {
      source_package: "@hasna/todos";
      authority: "todos";
      target_kind: "task";
      locator: { kind: "external_uuid"; value: string };
    })
  | (ProjectResourceLinkInputBase & {
      source_package: "@hasna/conversations";
      authority: "conversations";
      target_kind: "project";
      locator: { kind: "external_uuid"; value: string } | { kind: "canonical_uri"; value: string };
    })
  | (ProjectResourceLinkInputBase & {
      source_package: "@hasna/conversations";
      authority: "conversations";
      target_kind: "channel";
      locator: { kind: "external_uuid"; value: string } | { kind: "conversations_channel_id"; value: string };
    })
  | (ProjectResourceLinkInputBase & {
      source_package: "@hasna/knowledge";
      authority: "knowledge";
      target_kind: "collection" | "item";
      locator: { kind: "external_uuid"; value: string } | { kind: "canonical_uri"; value: string };
    })
  | (ProjectResourceLinkInputBase & {
      source_package: "@hasna/mementos";
      authority: "mementos";
      target_kind: "project" | "item";
      locator: { kind: "external_uuid"; value: string } | { kind: "canonical_uri"; value: string };
    })
  | (ProjectResourceLinkInputBase & {
      source_package: "@hasna/orgs";
      authority: "orgs";
      target_kind: "org" | "project";
      locator: { kind: "external_uuid"; value: string } | { kind: "canonical_uri"; value: string };
    })
  | (ProjectResourceLinkInputBase & {
      source_package: "@hasna/contacts";
      authority: "contacts";
      target_kind: "contact";
      locator: { kind: "external_uuid"; value: string };
    });

/** Fields every resolved link carries, whichever authority it targets. */
export interface ProjectResourceLinkBase {
  id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
  labels: ProjectResourceLinkLabels;
  scope: "collection" | "resource";
  service_instance: string;
}

export type ProjectResourceLink =
  | (ProjectResourceLinkBase & {
      source_package: "@hasna/todos";
      authority: "todos";
      target_kind: "project" | "task_list" | "plan";
      locator: { kind: "external_uuid"; value: string } | { kind: "canonical_uri"; value: string };
    })
  | (ProjectResourceLinkBase & {
      source_package: "@hasna/todos";
      authority: "todos";
      target_kind: "task";
      locator: { kind: "external_uuid"; value: string };
    })
  | (ProjectResourceLinkBase & {
      source_package: "@hasna/conversations";
      authority: "conversations";
      target_kind: "project";
      locator: { kind: "external_uuid"; value: string } | { kind: "canonical_uri"; value: string };
    })
  | (ProjectResourceLinkBase & {
      source_package: "@hasna/conversations";
      authority: "conversations";
      target_kind: "channel";
      locator: { kind: "external_uuid"; value: string } | { kind: "conversations_channel_id"; value: string };
    })
  | (ProjectResourceLinkBase & {
      source_package: "@hasna/knowledge";
      authority: "knowledge";
      target_kind: "collection" | "item";
      locator: { kind: "external_uuid"; value: string } | { kind: "canonical_uri"; value: string };
    })
  | (ProjectResourceLinkBase & {
      source_package: "@hasna/mementos";
      authority: "mementos";
      target_kind: "project" | "item";
      locator: { kind: "external_uuid"; value: string } | { kind: "canonical_uri"; value: string };
    })
  | (ProjectResourceLinkBase & {
      source_package: "@hasna/orgs";
      authority: "orgs";
      target_kind: "org" | "project";
      locator: { kind: "external_uuid"; value: string } | { kind: "canonical_uri"; value: string };
    })
  | (ProjectResourceLinkBase & {
      source_package: "@hasna/contacts";
      authority: "contacts";
      target_kind: "contact";
      locator: { kind: "external_uuid"; value: string };
    });

export interface ProjectResourceLinkCollectionV1 {
  schema: "hasna.project_resource_link_collection.v1";
  project_id: string;
  current_revision: string;
  links: ProjectResourceLink[];
  link_count: number;
  max_items: number;
  collection_digest: string;
  complete: boolean;
  truncated: boolean;
}

// ── @hasna/contracts/auth — the serve API-key surface ───────────────────────

export type ApiKeyStatus = "active" | "revoked" | "expired" | "unknown";

export type ApiKeyVerifyFailureReason =
  | "malformed"
  | "unsupported_version"
  | "app_mismatch"
  | "bad_signature"
  | "not_yet_valid"
  | "expired"
  | "revoked"
  | "insufficient_scope"
  | "tenant_required"
  | "tenant_mismatch";

export type AuthDenyReason =
  | ApiKeyVerifyFailureReason
  | "missing_token"
  | "unknown_key"
  | "status_unavailable";

export interface AuthAuditEvent {
  outcome: "allow" | "deny";
  app: string;
  kid: string | null;
  tid: string | null;
  agent?: string | null;
  reason: AuthDenyReason | null;
  scopesRequired: string[];
  method: string | null;
  path: string | null;
  status: number;
  at: string;
}

export type AuthAuditHook = (event: AuthAuditEvent) => void | Promise<void>;