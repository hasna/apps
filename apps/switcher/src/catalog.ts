import { type Catalog, type Model, type Provider, type ProviderInput, Fault, modelSchema } from "./domain";
import { boundedJson } from "./http";
const positive = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
const strings = (v: unknown) => Array.isArray(v) && v.every(i => typeof i === "string") ? v : undefined;
const modalities = (v: unknown): string[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every(i => typeof i === "string")) throw new Fault(502, "invalid_catalog", "Provider returned malformed modality metadata.");
  return v.map(i => i.toLowerCase());
};
export type CatalogCredentialResolver = (provider: ProviderInput) => Promise<string | undefined>;
export async function discover(provider: Provider, env: Record<string, string | undefined> = process.env, resolveCredential?: CatalogCredentialResolver): Promise<Catalog> {
  const refreshedAt = new Date().toISOString();
  if (provider.manualModels.length) return {models: provider.manualModels, source: "manual", refreshedAt};
  if (provider.catalogFormat === "none")
    throw new Fault(422, "catalog_unsupported", "This provider has no documented model-list contract; configure manual models or an explicit catalog URL and parser.");
  const headers: Record<string, string> = {"accept": "application/json"};
  if (provider.catalogFormat === "fireworks" && !provider.catalogBaseUrl && !provider.catalogAccountId)
    throw new Fault(422, "catalog_account_required", "Fireworks model discovery requires a catalog account ID or an explicit catalog URL.");
  if (provider.catalogFormat === "fireworks" && !provider.catalogBaseUrl && new URL(provider.baseUrl).origin !== "https://api.fireworks.ai")
    throw new Fault(422, "catalog_url_required", "A custom Fireworks inference authority requires an explicit catalog URL; its deployment prefix cannot be inferred.");
  const catalogRoot = provider.catalogBaseUrl ?? (provider.catalogFormat === "fireworks"
    ? `https://api.fireworks.ai/v1/accounts/${encodeURIComponent(provider.catalogAccountId!)}` : provider.baseUrl);
  const url = new URL(`${catalogRoot}/${provider.modelsPath}`);
  if (provider.catalogFormat === "fireworks") url.searchParams.set("pageSize", "200");
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
  let fireworksTotal: number | undefined;
  for (let page = 0; page < 100; page++) {
    let response: Response;
    try { response = await fetch(url, {headers, redirect: "manual", signal: AbortSignal.timeout(20_000)}); }
    catch { throw new Fault(502, "provider_unavailable", "Provider catalog request failed."); }
    if (!response.ok) { await response.body?.cancel(); throw new Fault(502, "provider_rejected", `Provider catalog returned HTTP ${response.status}.`); }
    const data = await boundedJson(response);
    if (provider.catalogFormat === "fireworks" && data?.totalSize !== undefined) {
      if (typeof data.totalSize !== "number" || !Number.isInteger(data.totalSize) || data.totalSize < 0)
        throw new Fault(502, "invalid_catalog", "Fireworks catalog count metadata is malformed.");
      if (fireworksTotal !== undefined && fireworksTotal !== data.totalSize)
        throw new Fault(502, "incomplete_catalog", "Provider catalog count changed during pagination; retry the refresh.");
      fireworksTotal = data.totalSize;
    }
    // Together's native catalog is a bare array despite its inference API's
    // OpenAI compatibility. Do not silently accept that shape for other parsers.
    const rows = provider.catalogFormat === "together" ? data : provider.catalogFormat === "ollama" ? data?.models
      : provider.catalogFormat === "fireworks" ? data?.models : provider.catalogFormat === "dashscope" ? data?.output?.models : data?.data;
    if (!Array.isArray(rows)) throw new Fault(502, "invalid_catalog", "Expected a provider catalog with a model array matching its configured format.");
    for (const row of rows) {
      const id = provider.catalogFormat === "ollama" ? row?.model ?? row?.name : provider.catalogFormat === "fireworks" ? row?.name
        : provider.catalogFormat === "dashscope" ? row?.model : row?.id;
      if (typeof id !== "string") throw new Fault(502, "invalid_catalog", "Catalog entry is missing a model ID.");
      const candidate = {
        id, name: row.displayName ?? row.name ?? row.display_name ?? id,
        available: provider.catalogFormat === "mistral" && typeof row.archived === "boolean" ? !row.archived : undefined,
        description: typeof row.description === "string" ? row.description.slice(0, 8000) : undefined,
        contextWindow: positive(row.context_length ?? row.context_window ?? row.contextLength ?? row.model_info?.context_window ?? (provider.catalogFormat === "mistral" ? row.max_context_length : undefined)),
        maxOutputTokens: positive(row.top_provider?.max_completion_tokens ?? row.max_output_tokens ?? row.model_info?.max_output_tokens),
        inputModalities: strings(row.architecture?.input_modalities ?? row.input_modalities) ?? modalities(row.inference_metadata?.request_modality),
        outputModalities: strings(row.architecture?.output_modalities ?? row.output_modalities) ?? modalities(row.inference_metadata?.response_modality),
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
      if (provider.catalogFormat === "fireworks") {
        if (row.supportsImageInput === true) candidate.inputModalities = ["text", "image"];
        if (typeof row.supportsTools === "boolean") candidate.supportedParameters = row.supportsTools ? ["tools"] : [];
      }
      if (provider.catalogFormat === "dashscope") {
        if (row.features !== undefined && !Array.isArray(row.features)) throw new Fault(502, "invalid_catalog", "DashScope model features metadata is malformed.");
        if (Array.isArray(row.features)) candidate.supportedParameters = row.features.includes("function-calling") ? ["tools"] : [];
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
    if (provider.catalogFormat === "fireworks" && data.nextPageToken !== undefined && data.nextPageToken !== null) {
      if (typeof data.nextPageToken !== "string" || data.nextPageToken.length > 2000)
        throw new Fault(502, "invalid_catalog", "Provider catalog pagination did not advance.");
      if (data.nextPageToken) {
        if (seenCursors.has(data.nextPageToken)) throw new Fault(502, "invalid_catalog", "Provider catalog pagination did not advance.");
        seenCursors.add(data.nextPageToken); url.searchParams.set("pageToken", data.nextPageToken); url.searchParams.set("pageSize", "200"); continue;
      }
    }
    if (provider.catalogFormat === "fireworks") {
      if (fireworksTotal !== undefined && fireworksTotal !== models.size) throw new Fault(502, "incomplete_catalog", "Provider catalog count does not match the collected models; retry the refresh.");
      return {models: [...models.values()], source: "remote", refreshedAt};
    }
    if (provider.catalogFormat === "dashscope") {
      const output = data.output;
      const total = output?.total;
      const pageNo = output?.page_no;
      const pageSize = output?.page_size;
      if (typeof total !== "number" || !Number.isInteger(total) || total < 0 || typeof pageNo !== "number" || !Number.isInteger(pageNo) || pageNo < 1 || typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1)
        throw new Fault(502, "invalid_catalog", "DashScope catalog pagination metadata is malformed.");
      if (models.size < total && pageNo * pageSize < total) {
        const nextPage = pageNo + 1;
        if (seenCursors.has(String(nextPage))) throw new Fault(502, "invalid_catalog", "Provider catalog pagination did not advance.");
        seenCursors.add(String(nextPage)); url.searchParams.set("page_no", String(nextPage)); url.searchParams.set("page_size", String(pageSize)); continue;
      }
      if (models.size !== total) throw new Fault(502, "incomplete_catalog", "Provider catalog count does not match the collected models; retry the refresh.");
      return {models: [...models.values()], source: "remote", refreshedAt};
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
