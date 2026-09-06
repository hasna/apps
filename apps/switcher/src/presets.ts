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
  preset("openai", "OpenAI", [route("openai-responses", "https://api.openai.com/v1"), route("openai-chat", "https://api.openai.com/v1")],
    ["https://platform.openai.com/docs/api-reference/introduction", "https://platform.openai.com/docs/api-reference/models/list"], "OPENAI_API_KEY"),
  preset("xai", "xAI", ["openai-chat", "openai-responses", "anthropic-messages"].map(protocol => route(protocol as Protocol, "https://api.x.ai/v1")),
    ["https://api.x.ai/docs/", "https://docs.x.ai/developers/model-capabilities/text/generate-text"], "XAI_API_KEY"),
  preset("ollama", "Ollama", ["openai-chat", "openai-responses"].map(protocol => route(protocol as Protocol, "http://127.0.0.1:11434/v1", {
    catalogBaseUrl: "http://127.0.0.1:11434", modelsPath: "api/tags", catalogFormat: "ollama", catalogAuthStyle: "none",
    notes: protocol === "openai-responses" ? ["Requires Ollama 0.13.3 or newer; only stateless Responses are supported."] : [],
  })), ["https://docs.ollama.com/api/openai-compatibility", "https://docs.ollama.com/api/tags"]),
  preset("lmstudio", "LM Studio", ["openai-chat", "openai-responses", "anthropic-messages"].map(protocol => route(protocol as Protocol, "http://127.0.0.1:1234/v1", {
    notes: ["Server authentication is optional. Use --credential-env when authentication is enabled."],
  })), ["https://lmstudio.ai/docs/developer/rest"]),
  preset("groq", "Groq", [route("openai-chat", "https://api.groq.com/openai/v1"), route("openai-responses", "https://api.groq.com/openai/v1", {notes: ["Responses is an upstream beta API."]})],
    ["https://console.groq.com/docs/api-reference"], "GROQ_API_KEY"),
  preset("cerebras", "Cerebras", [route("openai-chat", "https://api.cerebras.ai/v1")],
    ["https://inference-docs.cerebras.ai/api-reference/chat-completions"], "CEREBRAS_API_KEY"),
  preset("mistral", "Mistral", [route("openai-chat", "https://api.mistral.ai/v1", {catalogFormat:"mistral"})],
    ["https://docs.mistral.ai/api/endpoint/chat", "https://docs.mistral.ai/api/endpoint/models"], "MISTRAL_API_KEY"),
  preset("together", "Together AI", [route("openai-chat", "https://api.together.ai/v1", {catalogFormat:"together"})],
    ["https://docs.together.ai/docs/inference/openai-compatibility", "https://docs.together.ai/reference/models"], "TOGETHER_API_KEY"),
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
  credentialEnv?: string; authStyle?: "bearer" | "x-api-key";
  catalogBaseUrl?: string; catalogCredentialEnv?: string; catalogAuthStyle?: "bearer" | "x-api-key" | "none";
  modelsPath?: string; catalogFormat?: ProviderInput["catalogFormat"];
};
export function providerFromPreset(presetId: string, options: PresetOptions = {}) {
  const preset = getProviderPreset(presetId);
  const selected = preset.protocols.find(p => (!options.protocol || p.protocol === options.protocol) && (!options.harness || compatible(options.harness, p.protocol)));
  if (!selected) throw new Fault(422, "protocol_mismatch", "This provider preset has no native protocol compatible with the requested harness. Choose an explicitly compatible gateway.");
  const baseUrl = options.baseUrl ?? selected.baseUrl;
  if (!baseUrl) throw new Fault(400, "endpoint_required", "This preset requires an explicit --url for its inference endpoint.");
  // An override is not authority to send a built-in account's key to another host.
  if (options.baseUrl && selected.baseUrl && new URL(endpoint(options.baseUrl)).origin !== new URL(selected.baseUrl).origin && preset.credentialEnv && !options.credentialEnv)
    throw new Fault(422, "credential_authority", "An endpoint on another origin requires an explicit --credential-env reference.");
  const suffix = selected.protocol === "anthropic-messages" ? "messages" : selected.protocol === "openai-responses" ? "responses" : "chat";
  // Endpoint overrides must not leave discovery pointed at the original provider.
  const catalogBaseUrl = options.catalogBaseUrl ?? (options.baseUrl ? undefined : selected.catalogBaseUrl);
  return parse(providerInputSchema, {
    id: options.id ?? `${preset.id}-${suffix}`, name: preset.name, baseUrl, protocol: selected.protocol,
    credentialEnv: options.credentialEnv ?? preset.credentialEnv, authStyle: options.authStyle ?? selected.authStyle,
    catalogBaseUrl, catalogCredentialEnv: options.catalogCredentialEnv,
    catalogAuthStyle: options.catalogAuthStyle ?? selected.catalogAuthStyle,
    catalogFormat: options.catalogFormat ?? selected.catalogFormat, modelsPath: options.modelsPath ?? selected.modelsPath,
  });
}

/** Resolve an alias only for the preset's exact credential reference and origin. */
export function providerCredential(provider: ProviderInput, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!provider.credentialEnv) return undefined;
  let value = env[provider.credentialEnv];
  if (!value) {
    const preset = providerPresets.find(p => p.credentialEnv === provider.credentialEnv && p.protocols.some(route =>
      route.protocol === provider.protocol && route.baseUrl && new URL(route.baseUrl).origin === new URL(provider.baseUrl).origin));
    value = preset?.credentialAliases.map(name => env[name]).find(Boolean);
  }
  if (value && /[\r\n]/.test(value)) throw new Fault(422, "credential_invalid", "Provider credential contains invalid header characters.");
  return value;
}
