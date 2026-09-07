import { Fault } from "./domain";

export type HermesModelRoles = {
  subagent?: string;
  fast?: string;
  planning?: string;
  review?: string;
  summary?: string;
  compaction?: string;
  weak?: string;
  editor?: string;
};

export type HermesModelPolicyFragment = {
  auxiliary: Record<string, {
    api_mode: string;
    provider: "custom";
    model: string;
    base_url: string;
    api_key_env: "SWITCHER_HERMES_AUX_API_KEY";
    fallback_chain: [];
  }>;
  delegation: { model: string; provider: "custom"; base_url: string };
  env: { apiKeyEnv: "SWITCHER_HERMES_AUX_API_KEY" };
};

const tasks: Readonly<Record<string, keyof HermesModelRoles>> = {
  approval: "weak", skills_hub: "fast", mcp: "fast", review: "review",
  triage_specifier: "planning", profile_description: "summary",
  compression: "compaction", vision: "subagent", title_generation: "summary",
  session_search: "fast", web_extract: "fast",
};

function model(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value)) throw new Fault(400, "invalid_model_policy", `${label} is invalid.`);
  return value;
}

function endpoint(value: unknown): string {
  if (typeof value !== "string") throw new Fault(400, "invalid_url", "Hermes auxiliary endpoint is invalid.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Fault(400, "invalid_url", "Hermes auxiliary endpoint is invalid."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) throw new Fault(400, "invalid_url", "Hermes auxiliary endpoint must be HTTPS or loopback HTTP without credentials.");
  return url.href.replace(/\/+$/, "");
}

/** Compile verified Hermes auxiliary config fields without serializing credentials. */
export function compileHermesModelPolicy(currentModel: string, roles: HermesModelRoles, baseUrl: string, apiMode = "chat_completions"): HermesModelPolicyFragment {
  const selected = model(currentModel, "model");
  if(roles.editor && roles.editor!==selected)throw new Fault(422,"unsupported_role","Hermes does not expose a separate editor model.");
  const endpointUrl = endpoint(baseUrl);
  const chosen = (role: keyof HermesModelRoles) => model(roles[role] ?? selected, `roles.${role}`);
  const auxiliary = Object.create(null) as HermesModelPolicyFragment["auxiliary"];
  for (const [task, role] of Object.entries(tasks)) auxiliary[task] = { api_mode: apiMode, provider: "custom", model: chosen(role), base_url: endpointUrl, api_key_env: "SWITCHER_HERMES_AUX_API_KEY", fallback_chain: [] };
  return { auxiliary, delegation: { model: chosen("subagent"), provider: "custom", base_url: endpointUrl }, env: { apiKeyEnv: "SWITCHER_HERMES_AUX_API_KEY" } };
}
