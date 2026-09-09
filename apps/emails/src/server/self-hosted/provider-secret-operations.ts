import { validateManagedProviderCredentials } from "./managed-provider-crypto.js";
import { ManagedProviderSecretError, type ManagedProviderSecrets, type ProviderSecretJob } from "./managed-provider-secrets.js";

function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) {
    throw new ManagedProviderSecretError("Unknown provider credential operation field", 400);
  }
}

/** Called only after operator authorization; actor and backend tenant come from authentication. */
export async function runProviderSecretOperation(
  backend: ManagedProviderSecrets,
  operation: ProviderSecretJob["operation"] | "advance" | "job" | "install",
  body: Record<string, unknown>,
  actor: string,
  id?: string,
) {
  if (operation === "install") {
    fields(body, ["credentials", "expected_revision"]);
    if (!id?.trim() || !("expected_revision" in body)) {
      throw new ManagedProviderSecretError("Provider ID and explicit expected_revision are required", 400);
    }
    let credentials;
    try { credentials = validateManagedProviderCredentials(body.credentials); }
    catch { throw new ManagedProviderSecretError("Credentials must contain only the required fields for SES or Resend", 400); }
    const receipt = await backend.install(id, credentials, body.expected_revision as number | null, actor);
    return { ...receipt, status: "complete", checked: false };
  }
  if (operation === "job") {
    fields(body, []);
    return backend.getJob(id ?? "");
  }
  if (operation === "advance") {
    fields(body, ["limit"]);
    if (body.limit !== undefined && typeof body.limit !== "number") throw new ManagedProviderSecretError("limit must be an integer", 400);
    return backend.advance(id ?? "", body.limit as number | undefined);
  }
  fields(body, operation === "revoke-root" ? ["idempotency_key", "key_id"] : ["idempotency_key"]);
  if (typeof body.idempotency_key !== "string" || (operation === "revoke-root" && typeof body.key_id !== "string")) {
    throw new ManagedProviderSecretError("A reusable idempotency_key and, for revocation, key_id are required", 400);
  }
  // Begin returns a durable receipt without an unbounded KMS batch. Clients explicitly resume it.
  return backend.begin(operation, body.idempotency_key, actor, body.key_id as string | undefined);
}
