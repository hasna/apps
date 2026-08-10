import { getMementosPackageVersion } from "../lib/package-version.js";
import type { ProjectAuthorityIdentity } from "../types/index.js";
import {
  MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE,
  MEMENTOS_PROJECT_REGISTRATION_ROUTE,
  MEMENTOS_PROJECT_RESOURCE_ROUTE,
  type MementosProjectRegistrationAuthorityOptions,
  type MementosProjectRegistrationCapability,
} from "./types.js";

export const MEMENTOS_PROJECT_AUTHORITY_ENV = {
  authorityId: "MEMENTOS_PROJECT_AUTHORITY_ID",
  tenantId: "MEMENTOS_PROJECT_TENANT_ID",
  corpusId: "MEMENTOS_PROJECT_CORPUS_ID",
} as const;

function configuredValue(
  override: string | undefined,
  envKey: string,
): string | null {
  return override?.trim()
    || process.env[envKey]?.trim()
    || null;
}

export class MementosProjectAuthorityIdentityError extends Error {
  readonly code = "MEMENTOS_PROJECT_AUTHORITY_UNCONFIGURED" as const;

  constructor(public readonly missing_env: string[]) {
    super(
      "Mementos project authority identity is not configured; set " +
      missing_env.join(", "),
    );
    this.name = "MementosProjectAuthorityIdentityError";
  }
}

/**
 * The one package-owned source for the authority binding advertised by the
 * live capability. Callers consume this binding instead of copying
 * authority/tenant/corpus literals into individual commands or data paths.
 */
export function resolveMementosProjectAuthorityIdentity(
  options: Pick<
    MementosProjectRegistrationAuthorityOptions,
    "authorityId" | "tenantId" | "corpusId"
  > = {},
): ProjectAuthorityIdentity {
  const authorityId = configuredValue(
    options.authorityId,
    MEMENTOS_PROJECT_AUTHORITY_ENV.authorityId,
  );
  const tenantId = configuredValue(
    options.tenantId,
    MEMENTOS_PROJECT_AUTHORITY_ENV.tenantId,
  );
  const corpusId = configuredValue(
    options.corpusId,
    MEMENTOS_PROJECT_AUTHORITY_ENV.corpusId,
  );
  if (!authorityId || !tenantId || !corpusId) {
    const missingEnv: string[] = [];
    if (!authorityId) missingEnv.push(MEMENTOS_PROJECT_AUTHORITY_ENV.authorityId);
    if (!tenantId) missingEnv.push(MEMENTOS_PROJECT_AUTHORITY_ENV.tenantId);
    if (!corpusId) missingEnv.push(MEMENTOS_PROJECT_AUTHORITY_ENV.corpusId);
    throw new MementosProjectAuthorityIdentityError(missingEnv);
  }
  return {
    authority_id: authorityId,
    tenant_id: tenantId,
    corpus_id: corpusId,
  };
}

export function buildMementosProjectRegistrationCapability(
  options: MementosProjectRegistrationAuthorityOptions = {},
): MementosProjectRegistrationCapability {
  const identity = resolveMementosProjectAuthorityIdentity(options);
  return {
    authority: "mementos",
    route: MEMENTOS_PROJECT_REGISTRATION_ROUTE,
    package_version: options.packageVersion ?? getMementosPackageVersion(),
    ...identity,
    supported_resources: ["project"],
    conditional_create: true,
    immutable_receipts: true,
    exact_terminal_lookup: true,
    exact_readback: true,
    conditional_inverse: true,
    ambiguous_outcome_reconciliation: true,
    guarded_update: true,
    guarded_update_route: MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE,
    no_write_dry_run: true,
    expected_revision_compare_and_swap: true,
    caller_idempotency: true,
    exact_inverse_rollback: true,
    project_resource_enumeration: true,
    project_resource_route: MEMENTOS_PROJECT_RESOURCE_ROUTE,
    project_resource_kinds: ["project", "knowledge", "memory", "session"],
    stable_keyset_pagination: true,
    explicit_membership_only: true,
  };
}
