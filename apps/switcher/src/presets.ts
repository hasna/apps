import { compatible, endpoint, Fault, parse, providerInputSchema, providerPresetSchema, type ProviderInput, type ProviderPreset, type Profile } from "./domain";

type Protocol = ProviderInput["protocol"];
type Route = ProviderPreset["protocols"][number];
const route = (protocol: Protocol, baseUrl?: string, options: Partial<Route> = {}): Route => ({
  protocol, baseUrl, authStyle: "bearer", catalogFormat: "openai", modelsPath: "models", notes: [], ...options,
});
const preset = (id: string, name: string, protocols: Route[], sources: string[], alias?: string): ProviderPreset =>
  parse(providerPresetSchema, {id, name, protocols, sources, credentialAliases: alias ? [alias] : [],
    credentialEnv: alias ? `SWITCHER_PROVIDER_${id.toUpperCase().replace(/-/g, "_")}` : undefined, verification: "documented"});

// These entries describe upstream contracts, not proof of successful live inference.
export const providerPresets: readonly ProviderPreset[] = [
  preset("deepseek", "DeepSeek", [
    route("openai-chat", "https://api.deepseek.com", {catalogBaseUrl: "https://api.deepseek.com"}),
    route("anthropic-messages", "https://api.deepseek.com/anthropic/v1", {catalogBaseUrl: "https://api.deepseek.com"}),
  ], ["https://api-docs.deepseek.com/guides/anthropic_api", "https://api-docs.deepseek.com/api/list-models"], "DEEPSEEK_API_KEY"),
  preset("openrouter", "OpenRouter", ["openai-chat", "openai-responses", "anthropic-messages"].map(protocol =>
    route(protocol as Protocol, "https://openrouter.ai/api/v1", {catalogAuthStyle: "none"})),
    ["https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties", "https://openrouter.ai/docs/guides/overview"], "OPENROUTER_API_KEY"),
  preset("anthropic", "Anthropic", [route("anthropic-messages", "https://api.anthropic.com/v1", {authStyle: "x-api-key"})],
    ["https://platform.claude.com/docs/en/api/overview", "https://platform.claude.com/docs/en/api/models/list"], "ANTHROPIC_API_KEY"),
  preset("gemini", "Google Gemini", [route("gemini-generate-content", "https://generativelanguage.googleapis.com/v1beta", {
    authStyle: "x-api-key", catalogBaseUrl: "https://generativelanguage.googleapis.com/v1beta", catalogFormat: "gemini", catalogAuthStyle: "x-api-key",
    notes: ["Gemini CLI uses the native generateContent wire with x-goog-api-key authentication; model IDs are returned as models/{id}."],
  }), route("openai-chat", "https://generativelanguage.googleapis.com/v1beta/openai")], ["https://ai.google.dev/api", "https://ai.google.dev/api/models", "https://github.com/google-gemini/gemini-cli", "https://ai.google.dev/gemini-api/docs/openai"], "GEMINI_API_KEY"),
  preset("openai", "OpenAI", [route("openai-responses", "https://api.openai.com/v1"), route("openai-chat", "https://api.openai.com/v1")],
    ["https://platform.openai.com/docs/api-reference/introduction", "https://platform.openai.com/docs/api-reference/models/list"], "OPENAI_API_KEY"),
  preset("azure-openai", "Azure OpenAI (v1)", [
    route("openai-responses", undefined, {authStyle: "api-key", catalogFormat: "none", notes: ["Pass the Azure OpenAI v1 resource endpoint ending in /openai/v1. The request model is your deployment name. Azure's model-definition list is not a deployment catalog, so configure manual deployment models or an explicit deployment catalog parser; Switcher does not synthesize deployment paths or api-version query parameters."]}),
    route("openai-chat", undefined, {authStyle: "api-key", catalogFormat: "none", notes: ["Pass the Azure OpenAI v1 resource endpoint ending in /openai/v1. Chat Completions is POST /chat/completions and accepts the literal api-key header. The request model is your deployment name; configure manual deployment models or an explicit deployment catalog parser because GET /models does not establish deployment names."]}),
  ], ["https://learn.microsoft.com/en-us/rest/api/aifoundry/azureopenai/models", "https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat", "https://learn.microsoft.com/en-us/rest/api/aifoundry/azureopenai/responses"], "AZURE_OPENAI_API_KEY"),
  preset("xai", "xAI", ["openai-chat", "openai-responses", "anthropic-messages"].map(protocol => route(protocol as Protocol, "https://api.x.ai/v1")),
    ["https://api.x.ai/docs/", "https://docs.x.ai/developers/model-capabilities/text/generate-text"], "XAI_API_KEY"),
  preset("ollama", "Ollama", ["openai-chat", "openai-responses"].map(protocol => route(protocol as Protocol, "http://127.0.0.1:11434/v1", {
    catalogBaseUrl: "http://127.0.0.1:11434", modelsPath: "api/tags", catalogFormat: "ollama", catalogAuthStyle: "none",
    notes: protocol === "openai-responses" ? ["Requires Ollama 0.13.3 or newer; only stateless Responses are supported."] : [],
  })), ["https://docs.ollama.com/api/openai-compatibility", "https://docs.ollama.com/api/tags"]),
  preset("lmstudio", "LM Studio", ["openai-chat", "openai-responses", "anthropic-messages"].map(protocol => route(protocol as Protocol, "http://127.0.0.1:1234/v1", {
    notes: ["Server authentication is optional. Use --credential-env when authentication is enabled."],
  })), ["https://lmstudio.ai/docs/developer/rest"]),
  preset("vllm", "vLLM (operator endpoint)", [
    route("openai-chat", undefined, {notes: ["Pass the operator's OpenAI-compatible URL, normally ending in /v1. vLLM exposes Chat Completions at /chat/completions and GET /models under that prefix; configure --credential-env only when the server was started with --api-key or VLLM_API_KEY."]}),
    route("openai-responses", undefined, {notes: ["Pass the operator's OpenAI-compatible URL, normally ending in /v1. Responses is available for supported text-generation models at /responses; configure --credential-env only when the server was started with --api-key or VLLM_API_KEY."]}),
    route("anthropic-messages", undefined, {notes: ["Pass the operator's URL, normally ending in /v1. vLLM exposes the Anthropic Messages API at /messages for supported deployments. Chat templates and the configured tool parser determine whether streaming and tool calls work for a served model; configure --credential-env only when the server was started with --api-key or VLLM_API_KEY."]}),
  ], ["https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/", "https://github.com/vllm-project/vllm/blob/main/docs/serving/online_serving/README.md"]),
  preset("litellm", "LiteLLM Proxy (operator endpoint)", [
    route("openai-chat", undefined, {notes: ["Pass the proxy's documented OpenAI-compatible base URL exactly; the official quick start uses the root server URL, while a deployment may add a prefix such as /v1. LiteLLM serves Chat Completions and GET /models relative to that URL; use --credential-env for the proxy's configured master key or other bearer token."]}),
    route("openai-responses", undefined, {notes: ["Pass the proxy's documented OpenAI-compatible base URL exactly; LiteLLM documents the Responses API under the same proxy root or deployment prefix. Use --credential-env for the proxy's configured master key or other bearer token."]}),
    route("anthropic-messages", undefined, {notes: ["Pass the complete inference prefix ending in /v1, including any deployment prefix. LiteLLM registers /v1/messages; Switcher appends /messages to the stored prefix and discovers /models there. This is a gateway adapter: streaming and tool behavior depend on the configured upstream model and route, so verify those capabilities independently. Use --credential-env for the proxy's configured master key or other bearer token."]}),
  ], ["https://docs.litellm.ai/", "https://docs.litellm.ai/docs/proxy/quick_start", "https://github.com/BerriAI/litellm/blob/main/litellm/proxy/anthropic_endpoints/endpoints.py"]),
  preset("groq", "Groq", [route("openai-chat", "https://api.groq.com/openai/v1"), route("openai-responses", "https://api.groq.com/openai/v1", {notes: ["Responses is an upstream beta API."]})],
    ["https://console.groq.com/docs/api-reference"], "GROQ_API_KEY"),
  preset("cerebras", "Cerebras", [route("openai-chat", "https://api.cerebras.ai/v1")],
    ["https://inference-docs.cerebras.ai/api-reference/chat-completions"], "CEREBRAS_API_KEY"),
  preset("mistral", "Mistral", [route("openai-chat", "https://api.mistral.ai/v1", {catalogFormat:"mistral"})],
    ["https://docs.mistral.ai/api/endpoint/chat", "https://docs.mistral.ai/api/endpoint/models"], "MISTRAL_API_KEY"),
  preset("together", "Together AI", [route("openai-chat", "https://api.together.ai/v1", {catalogFormat:"together"})],
    ["https://docs.together.ai/docs/inference/openai-compatibility", "https://docs.together.ai/reference/models"], "TOGETHER_API_KEY"),
  preset("fireworks", "Fireworks AI", [
    route("openai-chat", "https://api.fireworks.ai/inference/v1", {catalogFormat:"fireworks", notes:["Model discovery uses GET /v1/accounts/{account_id}/models; provide --catalog-account-id or --catalog-url."]}),
    route("openai-responses", "https://api.fireworks.ai/inference/v1", {catalogFormat:"fireworks", notes:["Model discovery uses GET /v1/accounts/{account_id}/models; provide --catalog-account-id or --catalog-url."]}),
    route("anthropic-messages", "https://api.fireworks.ai/inference/v1", {catalogFormat:"fireworks", notes:["Model discovery uses GET /v1/accounts/{account_id}/models; provide --catalog-account-id or --catalog-url."]}),
  ], ["https://docs.fireworks.ai/getting-started/quickstart", "https://docs.fireworks.ai/tools-sdks/python-client/api-reference", "https://docs.fireworks.ai/api-reference/anthropic-messages", "https://docs.fireworks.ai/api-reference/post-chatcompletions", "https://docs.fireworks.ai/api-reference/list-models"], "FIREWORKS_API_KEY"),
  preset("moonshot", "Moonshot AI (Kimi)", [route("openai-chat", "https://api.moonshot.ai/v1", {catalogBaseUrl:"https://api.moonshot.ai/v1"})],
    ["https://platform.kimi.ai/docs/api/chat", "https://platform.kimi.ai/docs/api/list-models"], "MOONSHOT_API_KEY"),
  preset("dashscope", "Alibaba Cloud Model Studio (Qwen)", [route("openai-chat", "https://dashscope-us.aliyuncs.com/compatible-mode/v1", {
    catalogFormat:"none", notes: ["Inference keys and endpoints are region/workspace-specific. Model discovery uses GET /api/v1/models on a documented region or workspace catalog URL; pass --catalog-url and --catalog-format dashscope."],
  })], ["https://help.aliyun.com/en/model-studio/base-url", "https://help.aliyun.com/en/model-studio/compatibility-of-openai-with-dashscope", "https://help.aliyun.com/en/model-studio/list-models"], "DASHSCOPE_API_KEY"),
  preset("zai", "Z.AI", [route("openai-chat", "https://api.z.ai/api/paas/v4", {
    catalogFormat:"none", notes: ["The published API reference documents inference endpoints but no model-list endpoint; use manual models or provide an explicit catalog URL and parser."],
  })], ["https://docs.z.ai/api-reference/introduction", "https://docs.z.ai/devpack/quick-start"], "ZAI_API_KEY"),
  preset("minimax", "MiniMax", [
    route("openai-chat", "https://api.minimax.cn/v1", {catalogBaseUrl:"https://api.minimax.cn/v1", notes:["The Open Platform contract uses api.minimax.cn and Bearer auth. Token Plan documentation uses api.minimaxi.com; select that authority explicitly with --url and matching auth/credential settings."]}),
    route("anthropic-messages", "https://api.minimax.cn/anthropic/v1", {authStyle:"x-api-key", catalogBaseUrl:"https://api.minimax.cn/anthropic/v1", catalogAuthStyle:"x-api-key", notes:["The Open Platform contract uses api.minimax.cn/anthropic/v1 and X-Api-Key. Token Plan documentation uses api.minimaxi.com/anthropic; select that authority explicitly with --url and matching auth/credential settings."]}),
  ], ["https://platform.minimaxi.com/docs/api-reference/text-chat-anthropic", "https://platform.minimaxi.com/docs/api-reference/models/anthropic/list-models", "https://platform.minimaxi.com/docs/api-reference/models/openai/list-models", "https://platform.minimaxi.com/docs/token-plan/other-tools"], "MINIMAX_API_KEY"),
  preset("siliconflow", "SiliconFlow", [route("openai-chat", "https://api.siliconflow.cn/v1", {catalogBaseUrl:"https://api.siliconflow.cn/v1", catalogFormat:"openai", notes:["The official SiliconCloud OpenAPI contract defines GET /models with Bearer auth and data[] model rows; optional type and sub_type filters are available at the upstream endpoint."]})],
    ["https://github.com/siliconflow/siliconcloud/blob/main/openapi.yaml", "https://docs.siliconflow.cn/docs/userguide/quickstart", "https://docs.siliconflow.cn/docs/api/chat-completions-post"], "SILICONFLOW_API_KEY"),
  ...(["anthropic-messages", "openai-responses", "openai-chat"] as const).map(protocol =>
    preset(`generic-${protocol}`, `Custom ${protocol}`, [route(protocol)], [])),
];

export function getProviderPreset(id: string) {
  const entry = providerPresets.find(p => p.id === id);
  if (!entry) throw new Fault(404, "preset_not_found", "Unknown provider preset. Use switcher providers presets to list available presets.");
  return structuredClone(entry);
}
export type PresetOptions = {
  id?: string; protocol?: Protocol; harness?: Profile["harness"]; baseUrl?: string;
  credentialEnv?: string; authStyle?: "bearer" | "x-api-key" | "api-key";
  catalogBaseUrl?: string; catalogCredentialEnv?: string; catalogAuthStyle?: "bearer" | "x-api-key" | "api-key" | "none";
  modelsPath?: string; catalogFormat?: ProviderInput["catalogFormat"]; catalogAccountId?: string;
};
export function providerFromPreset(presetId: string, options: PresetOptions = {}) {
  const preset = getProviderPreset(presetId);
  const selected = preset.protocols.find(p => (!options.protocol || p.protocol === options.protocol) && (!options.harness || compatible(options.harness, p.protocol)));
  if (!selected) throw new Fault(422, "protocol_mismatch", "This provider preset has no native protocol compatible with the requested harness. Choose an explicitly compatible gateway.");
  const baseUrl = options.baseUrl ?? selected.baseUrl;
  if (!baseUrl) throw new Fault(400, "endpoint_required", "This preset requires an explicit --url for its inference endpoint.");
  if (presetId === "azure-openai" && !/\/openai\/v1$/.test(endpoint(baseUrl)))
    throw new Fault(400, "invalid_url", "Azure OpenAI v1 requires an explicit endpoint ending in /openai/v1; deployment and api-version URLs are unsupported.");
  // An override is not authority to send a built-in account's key to another host.
  if (options.baseUrl && selected.baseUrl && new URL(endpoint(options.baseUrl)).origin !== new URL(selected.baseUrl).origin && preset.credentialEnv && !options.credentialEnv)
    throw new Fault(422, "credential_authority", "An endpoint on another origin requires an explicit --credential-env reference.");
  const suffix = selected.protocol === "anthropic-messages" ? "messages" : selected.protocol === "openai-responses" ? "responses" : "chat";
  // Endpoint overrides must not leave discovery pointed at the original provider.
  if (presetId === "fireworks" && !options.catalogBaseUrl && !options.catalogAccountId)
    throw new Fault(400, "catalog_account_required", "Fireworks model discovery requires --catalog-account-id or an explicit --catalog-url.");
  if (selected.catalogFormat === "none" && options.catalogFormat && !options.catalogBaseUrl)
    throw new Fault(400, "catalog_url_required", "This preset requires an explicit --catalog-url when enabling a catalog parser.");
  const catalogBaseUrl = options.catalogBaseUrl ?? (presetId === "fireworks" && options.catalogAccountId
    ? `https://api.fireworks.ai/v1/accounts/${encodeURIComponent(options.catalogAccountId)}`
    : options.baseUrl ? undefined : selected.catalogBaseUrl);
  return parse(providerInputSchema, {
    id: options.id ?? `${preset.id}-${suffix}`, name: preset.name, baseUrl, protocol: selected.protocol,
    credentialEnv: options.credentialEnv ?? preset.credentialEnv, authStyle: options.authStyle ?? selected.authStyle,
    catalogBaseUrl, catalogCredentialEnv: options.catalogCredentialEnv,
    catalogAuthStyle: options.catalogAuthStyle ?? selected.catalogAuthStyle,
    catalogFormat: options.catalogFormat ?? selected.catalogFormat, catalogAccountId: options.catalogAccountId,
    modelsPath: options.modelsPath ?? selected.modelsPath,
  });
}

/** Resolve an alias only for the preset's exact credential reference and origin. */
export function providerCredential(provider: ProviderInput, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!provider.credentialEnv) return undefined;
  let value = env[provider.credentialEnv];
  if (!value) {
    const preset = providerPresets.find(p => p.credentialEnv === provider.credentialEnv && p.protocols.some(route =>
      route.protocol === provider.protocol && (route.baseUrl ? new URL(route.baseUrl).origin === new URL(provider.baseUrl).origin : p.id === "azure-openai")));
    value = preset?.credentialAliases.map(name => env[name]).find(Boolean);
  }
  if (value && /[\r\n]/.test(value)) throw new Fault(422, "credential_invalid", "Provider credential contains invalid header characters.");
  return value;
}
