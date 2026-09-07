import { createProvider, deleteProvider, getProvider, listProviderSummaries, updateProvider } from "../../db/providers.js";
import { redactSecrets } from "../../lib/redaction.js";
import { fetchProviderSecretStatus, writeApiManagedProvider } from "../../lib/provider-secret-api.js";
import type { ProviderType } from "../../types/index.js";
import { resolveId } from "../helpers.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ProviderToolName =
  | "list_providers"
  | "add_provider"
  | "update_provider"
  | "remove_provider";

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function text(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}

function json(data: unknown): ToolResult {
  return text(JSON.stringify(data, null, 2));
}

function publicProvider(provider: Record<string, unknown>): Record<string, unknown> {
  const out = { ...provider };
  for (const field of [
    "api_key", "access_key", "secret_key", "oauth_client_id",
    "oauth_client_secret", "oauth_refresh_token", "oauth_access_token", "oauth_token_expiry",
  ]) delete out[field];
  return out;
}

const credentialFields = ["api_key", "access_key", "secret_key"] as const;
function credentialsFrom(input: Record<string, unknown>) {
  const credentials: { api_key?: string; access_key?: string; secret_key?: string } = {};
  for (const field of credentialFields) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== "string" || !input[field]) throw new Error(`Provider ${field} must be a nonempty string.`);
    credentials[field] = input[field];
  }
  return credentials;
}
function safeError(error: unknown, input: Record<string, unknown>): string {
  let message = formatError(error);
  for (const field of credentialFields) {
    const value = input[field];
    if (typeof value === "string" && value) message = message.replaceAll(value, "[REDACTED]");
  }
  return message;
}

export async function runProviderTool(name: ProviderToolName, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "list_providers": {
        const limit = typeof input["limit"] === "number" ? input["limit"] : undefined;
        const offset = typeof input["offset"] === "number" ? input["offset"] : undefined;
        const effectiveLimit = limit ?? 100;
        const providers = listProviderSummaries({ limit: effectiveLimit, offset: offset ?? 0 });
        return json({
          providers: redactSecrets(providers),
          limit: effectiveLimit,
          offset: offset ?? 0,
          cli_equivalent: `emails provider list${limit !== undefined ? ` --limit ${limit}` : ""}${offset !== undefined ? ` --offset ${offset}` : ""} --json`,
        });
      }
      case "add_provider": {
        const { name: providerName, type, region } = input;
        if (typeof providerName !== "string" || !providerName.trim() || !["ses", "resend", "sandbox"].includes(String(type))) throw new Error("Provider name and supported type are required.");
        const credentials = credentialsFrom(input);
        if (Object.keys(credentials).length) {
          if (type === "sandbox") throw new Error("Sandbox providers do not accept delivery credentials.");
          const id = input.id === undefined ? crypto.randomUUID() : String(input.id);
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Supply a reusable UUID provider id for managed creation.");
          try {
            const receipt = await writeApiManagedProvider(id, { create: true, name: providerName, type: type as "ses" | "resend", region: typeof region === "string" ? region : null, credentials, expected_revision: null, skip_validation: input.skip_validation === true });
            return json(receipt);
          } catch (error) {
            throw new Error(`${safeError(error, input)} Provider ID: ${id}. Inspect this ID before retrying; reuse the same id to avoid duplicate registration.`);
          }
        }
        if (input.id !== undefined) throw new Error("An explicit id is supported for managed credential creation only.");
        const provider = createProvider({ name: providerName, type: type as ProviderType, ...(typeof region === "string" ? { region } : {}) });
        return json({ ...publicProvider(provider as unknown as Record<string, unknown>), checked: false, credential_source: "registry_only" });
      }
      case "update_provider": {
        if (typeof input.id !== "string" || !input.id.trim()) throw new Error("Provider ID must not be empty.");
        const resolvedId = resolveId("providers", input.id);
        const credentials = credentialsFrom(input);
        const status = (Object.keys(credentials).length || input.region !== undefined) ? await fetchProviderSecretStatus() : undefined;
        const managed = status?.providers.find(provider => provider.provider_id === resolvedId);
        if (Object.keys(credentials).length || managed?.credential_source === "managed_envelope") {
          if (managed?.credential_source === "managed_envelope" && (!Number.isSafeInteger(managed.revision) || managed.revision! < 1)) throw new Error("The API did not report the managed credential revision; inspect provider status before updating.");
          return json(await writeApiManagedProvider(resolvedId, { credentials, expected_revision: managed?.revision ?? null, ...(typeof input.name === "string" ? { name: input.name } : {}), ...(typeof input.region === "string" ? { region: input.region } : {}), skip_validation: input.skip_validation === true }));
        }
        return json({ ...publicProvider(updateProvider(resolvedId, { ...(typeof input.name === "string" ? { name: input.name } : {}), ...(typeof input.region === "string" ? { region: input.region } : {}) }) as unknown as Record<string, unknown>), checked: false });
      }
      case "remove_provider": {
        const providerRef = String(input["provider_id"]);
        const id = resolveId("providers", providerRef);
        const provider = getProvider(id);
        if (!provider) throw new Error(`Provider not found: ${id}`);
        deleteProvider(id);
        return text(`Provider removed: ${provider.name}`);
      }
    }
  } catch (error) {
    return text(`Error: ${safeError(error, input)}`, true);
  }
}
