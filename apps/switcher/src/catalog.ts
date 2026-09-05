import { type Catalog, type Model, type Provider, Fault, modelSchema, parse } from "./domain";
import { boundedJson } from "./http";
const positive = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
const strings = (v: unknown) => Array.isArray(v) && v.every(i => typeof i === "string") ? v : undefined;
export async function discover(provider: Provider, env: Record<string, string | undefined> = process.env): Promise<Catalog> {
  const refreshedAt = new Date().toISOString();
  if (provider.manualModels.length) return {models: provider.manualModels, source: "manual", refreshedAt};
  const headers: Record<string, string> = {"accept": "application/json"};
  if (provider.credentialEnv) {
    const credential = env[provider.credentialEnv];
    if (!credential) throw new Fault(422, "credential_missing", "Provider credential environment variable is not available on the server.");
    headers[provider.authStyle === "x-api-key" ? "x-api-key" : "authorization"] = provider.authStyle === "x-api-key" ? credential : `Bearer ${credential}`;
  }
  const url = new URL(`${provider.baseUrl}/${provider.modelsPath}`);
  if (provider.protocol === "anthropic-messages" && url.hostname !== "openrouter.ai") headers["anthropic-version"] = "2023-06-01";
  // OpenRouter defaults to text-only; retain other modalities for truthful catalog browsing.
  if (url.hostname === "openrouter.ai") url.searchParams.set("output_modalities", "all");
  const models = new Map<string, Model>(); const seenCursors = new Set<string>();
  for (let page = 0; page < 100; page++) {
    let response: Response;
    try { response = await fetch(url, {headers, redirect: "manual", signal: AbortSignal.timeout(20_000)}); }
    catch { throw new Fault(502, "provider_unavailable", "Provider catalog request failed."); }
    if (!response.ok) { await response.body?.cancel(); throw new Fault(502, "provider_rejected", `Provider catalog returned HTTP ${response.status}.`); }
    const data = await boundedJson(response);
    if (!Array.isArray(data.data)) throw new Fault(502, "invalid_catalog", "Expected a provider catalog with a data array.");
    for (const row of data.data) {
      if (!row || typeof row.id !== "string") throw new Fault(502, "invalid_catalog", "Catalog entry is missing a model ID.");
      const candidate = {
        id: row.id, name: row.name ?? row.display_name ?? row.id,
        description: typeof row.description === "string" ? row.description.slice(0, 8000) : undefined,
        contextWindow: positive(row.context_length ?? row.context_window),
        maxOutputTokens: positive(row.top_provider?.max_completion_tokens ?? row.max_output_tokens),
        inputModalities: strings(row.architecture?.input_modalities ?? row.input_modalities),
        outputModalities: strings(row.architecture?.output_modalities ?? row.output_modalities),
        supportedParameters: strings(row.supported_parameters),
      };
      const parsed = modelSchema.safeParse(candidate);
      if (!parsed.success) throw new Fault(502, "invalid_catalog", "Provider returned malformed model metadata.");
      models.set(candidate.id, parsed.data);
      if (models.size > 10000) throw new Fault(502, "catalog_too_large", "Catalog exceeds 10,000 models; configure a narrower endpoint.");
    }
    if (!data.has_more) return {models: [...models.values()], source: "remote", refreshedAt};
    const cursor = data.last_id;
    if (typeof cursor !== "string" || seenCursors.has(cursor)) throw new Fault(502, "invalid_catalog", "Provider catalog pagination did not advance.");
    seenCursors.add(cursor); url.searchParams.set("after_id", cursor); url.searchParams.set("limit", "1000");
  }
  throw new Fault(502, "catalog_too_large", "Provider catalog pagination exceeded 100 pages.");
}
