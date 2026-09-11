import { ManagedProviderSecretError, type ManagedProviderSecrets } from "./managed-provider-secrets.js";
import type { ManagedProviderCredentials } from "./managed-provider-crypto.js";
import { buildSelfHostedSender } from "./sender.js";

export type ManagedCredentialValidator = (credentials: ManagedProviderCredentials, region: string | null, signal: AbortSignal) => Promise<void>;

export const probeManagedCredentials: ManagedCredentialValidator = async (credentials, region, signal) => {
  const env: NodeJS.ProcessEnv = { EMAILS_SEND_PROVIDER: credentials.type };
  if (credentials.type === "resend") env.RESEND_API_KEY = credentials.api_key;
  else {
    if (!region || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) throw new ManagedProviderSecretError("A valid SES region is required", 400);
    env.EMAILS_AWS_REGION = region;
    env.EMAILS_SES_ACCESS_KEY_ID = credentials.access_key;
    env.EMAILS_SES_SECRET_ACCESS_KEY = credentials.secret_key;
  }
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  try {
    const probe = buildSelfHostedSender(env).probe;
    if (!probe) throw Error("probe unavailable");
    const result = await probe(deadline);
    if (result.sendingEnabled === false) throw Error("sending disabled");
  } catch {
    throw new ManagedProviderSecretError("Server credential validation failed or timed out; no provider changes were saved. Check credentials and server connectivity, or explicitly skip validation.", 422);
  }
};

export async function writeManagedProvider(backend: ManagedProviderSecrets, id: string, body: Record<string, unknown>, actor: string, validate = probeManagedCredentials) {
  const allowed = ["create", "name", "type", "region", "credentials", "expected_revision", "skip_validation"];
  if (Object.keys(body).some(key => !allowed.includes(key)) || !("expected_revision" in body)) throw new ManagedProviderSecretError("Invalid provider fields or missing expected_revision", 400);
  if (body.create !== undefined && typeof body.create !== "boolean" || body.skip_validation !== undefined && typeof body.skip_validation !== "boolean") throw new ManagedProviderSecretError("create and skip_validation must be booleans", 400);
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 256 || /[\x00-\x1f\x7f]/.test(body.name))) throw new ManagedProviderSecretError("Provider name must be non-empty text", 400);
  if (body.region !== undefined && body.region !== null && (typeof body.region !== "string" || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(body.region))) throw new ManagedProviderSecretError("Invalid provider region", 400);
  if (!body.credentials || typeof body.credentials !== "object" || Array.isArray(body.credentials) || Object.keys(body.credentials).some(key => !["api_key", "access_key", "secret_key"].includes(key))) throw new ManagedProviderSecretError("Invalid credential fields", 400);
  for (const value of Object.values(body.credentials)) if (typeof value !== "string" || !value.trim() || value.length > 16384 || /[\x00-\x1f\x7f]/.test(value)) throw new ManagedProviderSecretError("Credential values must be non-empty strings", 400);
  if (body.create && (!body.name || !["ses", "resend"].includes(String(body.type)) || body.expected_revision !== null)) throw new ManagedProviderSecretError("Creation requires name, SES/Resend type, and null expected_revision", 400);
  if(body.create&&body.type==="ses"&&!body.region)throw new ManagedProviderSecretError("SES provider creation requires a region",400);
  if(body.create&&body.type==="resend"&&body.region)throw new ManagedProviderSecretError("Resend providers do not use an SES region",400);
  if (!body.create && body.type !== undefined) throw new ManagedProviderSecretError("Changing provider type is not supported", 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ManagedProviderSecretError("A full provider UUID is required", 400);
  const metadata = { ...(body.name !== undefined ? { name: String(body.name).trim() } : {}), ...(body.type !== undefined ? { type: body.type as "ses" | "resend" } : {}), ...("region" in body ? { region: body.region as string | null } : {}) };
  const receipt = await backend.install(id, body.credentials, body.expected_revision as number | null, actor, { create: body.create === true, metadata, partial: true, ...(body.skip_validation === true ? {} : { validate }) });
  return { ...receipt, status: "complete" as const, checked: body.skip_validation !== true };
}
