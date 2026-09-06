import { type Catalog, type Model, type Provider, type ProviderInput, Fault, modelSchema } from "./domain";
import { boundedJson } from "./http";
const positive = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
const strings = (v: unknown) => Array.isArray(v) && v.every(i => typeof i === "string") ? v : undefined;
export type CatalogCredentialResolver = (provider: ProviderInput) => Promise<string | undefined>;
export async function discover(provider: Provider, env: Record<string, string | undefined> = process.env, resolveCredential?: CatalogCredentialResolver): Promise<Catalog> {
  const refreshedAt = new Date().toISOString();
  if (provider.manualModels.length) return {models: provider.manualModels, source: "manual", refreshedAt};
  const headers: Record<string, string> = {"accept": "application/json"};
  const url = new URL(`${provider.catalogBaseUrl ?? provider.baseUrl}/${provider.modelsPath}`);
  const authStyle = provider.catalogAuthStyle ?? provider.authStyle;
  const credentialEnv = provider.catalogCredentialEnv ?? provider.credentialEnv;
  if (authStyle !== "none" && credentialEnv) {
    if (url.origin !== new URL(provider.baseUrl).origin && !provider.catalogCredentialEnv)
      throw new Fault(422, "catalog_credential_authority", "A different catalog origin requires an explicit catalog credential reference or catalogAuthStyle: none.");
    const credential = resolveCredential ? await resolveCredential({...provider,baseUrl:provider.catalogBaseUrl ?? provider.baseUrl,credentialEnv}) : env[credentialEnv];
    if (!credential) throw new Fault(422, "credential_missing", "Provider credential environment variable is not available on the server.");
    if (/[\r\n]/.test(credential)) throw new Fault(422, "credential_invalid", "Catalog credential contains invalid header characters.");
    headers[authStyle === "x-api-key" ? "x-api-key" : "authorization"] = authStyle === "x-api-key" ? credential : `Bearer ${credential}`;
  }
  if (provider.protocol === "anthropic-messages" && url.hostname !== "openrouter.ai") headers["anthropic-version"] = "2023-06-01";
  // OpenRouter defaults to text-only; retain other modalities for truthful catalog browsing.
  if (url.hostname === "openrouter.ai") url.searchParams.set("output_modalities", "all");
  const models = new Map<string, Model>(); const seenCursors = new Set<string>();
  const seenPages = new Set<string>([url.href]);
  for (let page = 0; page < 100; page++) {
    let response: Response;
    try { response = await fetch(url, {headers, redirect: "manual", signal: AbortSignal.timeout(20_000)}); }
    catch { throw new Fault(502, "provider_unavailable", "Provider catalog request failed."); }
    if (!response.ok) { await response.body?.cancel(); throw new Fault(502, "provider_rejected", `Provider catalog returned HTTP ${response.status}.`); }
    const data = await boundedJson(response);
    // Together's native catalog is a bare array despite its inference API's
    // OpenAI compatibility. Do not silently accept that shape for other parsers.
    const rows = provider.catalogFormat === "together" ? data : provider.catalogFormat === "ollama" ? data?.models : data?.data;
    if (!Array.isArray(rows)) throw new Fault(502, "invalid_catalog", "Expected a provider catalog with a model array matching its configured format.");
    for (const row of rows) {
      const id = provider.catalogFormat === "ollama" ? row?.model ?? row?.name : row?.id;
      if (typeof id !== "string") throw new Fault(502, "invalid_catalog", "Catalog entry is missing a model ID.");
      const candidate = {
        id, name: row.name ?? row.display_name ?? id,
        available: provider.catalogFormat === "mistral" && typeof row.archived === "boolean" ? !row.archived : undefined,
        description: typeof row.description === "string" ? row.description.slice(0, 8000) : undefined,
        contextWindow: positive(row.context_length ?? row.context_window ?? (provider.catalogFormat === "mistral" ? row.max_context_length : undefined)),
        maxOutputTokens: positive(row.top_provider?.max_completion_tokens ?? row.max_output_tokens),
        inputModalities: strings(row.architecture?.input_modalities ?? row.input_modalities),
        outputModalities: strings(row.architecture?.output_modalities ?? row.output_modalities),
        supportedParameters: strings(row.supported_parameters),
      };
      if (provider.catalogFormat === "mistral") {
        const capabilities = row.capabilities;
        if (typeof capabilities?.function_calling === "boolean") candidate.supportedParameters = capabilities.function_calling ? ["tools"] : [];
        if (typeof capabilities?.vision === "boolean") candidate.inputModalities = capabilities.vision ? ["text", "image"] : ["text"];
        if (typeof capabilities?.completion_chat === "boolean") candidate.outputModalities = capabilities.completion_chat ? ["text"] : [];
      }
      if (provider.catalogFormat === "together") {
        const modalities: Record<string,string[]> = {chat:["text"],language:["text"],code:["text"],image:["image"],audio:["audio"],video:["video"],embedding:["embedding"],rerank:["rerank"],moderation:["classification"]};
        candidate.outputModalities = modalities[row.type];
      }
      const parsed = modelSchema.safeParse(candidate);
      if (!parsed.success) throw new Fault(502, "invalid_catalog", "Provider returned malformed model metadata.");
      models.set(candidate.id, parsed.data);
      if (models.size > 10000) throw new Fault(502, "catalog_too_large", "Catalog exceeds 10,000 models; configure a narrower endpoint.");
    }
    const next = data.links?.next;
    if (next !== undefined && next !== null) {
      if (typeof next !== "string" || !next || next.length > 2000) throw new Fault(502, "invalid_catalog", "Provider returned an invalid catalog continuation link.");
      let target: URL;
      try { target = new URL(next, url); } catch { throw new Fault(502, "invalid_catalog", "Provider returned an invalid catalog continuation link."); }
      // Pagination is authority to change the page, never the authenticated
      // destination or route. This also prevents credentials in link URLs.
      if (target.origin !== url.origin || target.pathname !== url.pathname || target.username || target.password || target.hash)
        throw new Fault(502, "catalog_credential_authority", "Catalog pagination must stay on its original origin and path.");
      if (url.searchParams.has("output_modalities")) target.searchParams.set("output_modalities", url.searchParams.get("output_modalities")!);
      if (seenPages.has(target.href)) throw new Fault(502, "invalid_catalog", "Provider catalog pagination did not advance.");
      seenPages.add(target.href); url.href = target.href; continue;
    }
    if (provider.catalogFormat === "together" || !data.has_more) {
      if (typeof data.total_count === "number" && data.total_count !== models.size)
        throw new Fault(502, "incomplete_catalog", "Provider catalog count does not match the collected models; retry the refresh.");
      return {models: [...models.values()], source: "remote", refreshedAt};
    }
    const cursor = data.last_id;
    if (typeof cursor !== "string" || seenCursors.has(cursor)) throw new Fault(502, "invalid_catalog", "Provider catalog pagination did not advance.");
    seenCursors.add(cursor); url.searchParams.set("after_id", cursor); url.searchParams.set("limit", "1000");
  }
  throw new Fault(502, "catalog_too_large", "Provider catalog pagination exceeded 100 pages.");
}
