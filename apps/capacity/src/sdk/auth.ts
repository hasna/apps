import { AccountsError } from "../errors";
import type { AccountsAuthProvider } from "./types";

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const CREDENTIAL_PATTERN = /^[\x21-\x7e]{1,4096}$/;

/**
 * Exchanges a Secrets-managed capacity client credential reference for the
 * separately audienced credential the capacity API accepts. Accounts stores
 * and returns references, never credential material, so the resolver is always
 * owned by the deployment and never by this package.
 */
export interface AccountsCapacityCredentialResolver {
  resolve(reference: string, signal?: AbortSignal): Promise<string>;
}

/**
 * Builds the self-hosted authorization header from a reference. The reference
 * identifies the credential; it is never the credential and never reaches the
 * wire, a log, or a support bundle.
 */
export function createReferenceAuthProvider(
  reference: string,
  resolver: AccountsCapacityCredentialResolver,
): AccountsAuthProvider {
  if (typeof reference !== "string" || !REFERENCE_PATTERN.test(reference)) {
    throw new AccountsError("VALIDATION_FAILED", "Capacity credential reference is invalid", {
      details: { field: "capacityAuthRef" },
    });
  }
  if (
    resolver === null ||
    typeof resolver !== "object" ||
    typeof resolver.resolve !== "function"
  ) {
    throw new AccountsError("VALIDATION_FAILED", "Capacity credential resolver is invalid", {
      details: { field: "credentialResolver" },
    });
  }
  return Object.freeze({
    authorize: async (headers: Headers, signal?: AbortSignal): Promise<void> => {
      let credential: unknown;
      try {
        credential = await resolver.resolve(reference, signal);
      } catch (error) {
        if (error instanceof AccountsError) throw error;
        throw unresolvable(true);
      }
      if (typeof credential !== "string" || !CREDENTIAL_PATTERN.test(credential)) {
        throw unresolvable(false);
      }
      // An echoed reference is not a credential: it can never carry the
      // issuer/audience the API requires, and forwarding it would publish a
      // Secrets locator to the wire.
      if (credential === reference) throw unresolvable(false);
      headers.set("authorization", `Bearer ${credential}`);
    },
  });
}

function unresolvable(retryable: boolean): AccountsError {
  return new AccountsError(
    "DEPENDENCY_UNAVAILABLE",
    "Capacity client credential resolution failed",
    { retryable },
  );
}
