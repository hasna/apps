import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { endpoint, codingEligible } from "./domain";
import type { HarnessLaunchInput, PreparedLaunch } from "./harness-types";

const KEY = "SWITCHER_HARNESS_API_KEY";
const API = {
  "anthropic-messages": "anthropic-messages",
  "openai-responses": "openai-responses",
  "openai-chat": "openai-completions",
} as const;

function selectedModels(input: HarnessLaunchInput) {
  if (!input.models.length || !input.models.some(model => model.id === input.model))
    throw new Error("Selected model is missing from the launch catalog.");
  if (input.models.some(model => !codingEligible(model)))
    throw new Error("Launch catalog contains a model explicitly ineligible for coding.");
  if (new Set(input.models.map(model => model.id.toLowerCase())).size !== input.models.length)
    throw new Error("OMP cannot safely select model IDs that differ only by letter case; update the provider catalog.");
  return input.models;
}

/**
 * Prepare an isolated OMP configuration. OMP reads models.yml as JSON-valid
 * YAML, and resolves the apiKey/header references from the child environment.
 * The credential therefore never reaches the generated files or command line.
 */
export async function prepareOmpLaunch(input: HarnessLaunchInput): Promise<PreparedLaunch> {
  if (input.protocol === "gemini-generate-content") throw new Error("OMP does not support the Gemini generateContent protocol.");
  if (input.protocol === "anthropic-messages" && input.authStyle === "api-key")
    throw new Error("OMP literal api-key Messages authentication requires the Switcher launch bridge; use prepareHarnessLaunch.");
  const models = selectedModels(input);
  const baseUrl = endpoint(input.baseUrl);
  if (input.credential && /[\r\n]/.test(input.credential)) throw new Error("Provider credential contains invalid header characters.");
  const agentDir = join(input.stateDir, "omp-agent");
  const sessionDir = input.sessionDir ?? join(input.stateDir, "sessions");
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });

  const api = API[input.protocol];
  const modelDefinitions = models.map(model => ({
    id: model.id,
    name: model.name,
    api,
    input: (model.inputModalities ?? ["text"]).filter(value => value === "text" || value === "image").length
      ? (model.inputModalities ?? ["text"]).filter(value => value === "text" || value === "image")
      : ["text"],
    supportsTools: model.supportedParameters?.includes("tools") ?? true,
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutputTokens ? { maxTokens: model.maxOutputTokens } : {}),
  }));
  const provider: Record<string, unknown> = {
    name: "Switcher",
    baseUrl,
    api,
    models: modelDefinitions,
  };
  if (input.authStyle === "x-api-key" || input.authStyle === "api-key") {
    // A keyless OMP provider prevents its OpenAI client from adding a second
    // Authorization header; the explicit header reference is still resolved
    // from the child environment for every request.
    provider.auth = "none";
    provider.headers = { [input.authStyle]: KEY };
  } else {
    provider.apiKey = KEY;
    provider.authHeader = true;
  }
  const modelsPath = join(agentDir, "models.yml");
  const configPath = join(agentDir, "config.yml");
  const selector = `switcher/${input.model}`;
  await writeFile(modelsPath, JSON.stringify({ providers: { switcher: provider } }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await writeFile(configPath, JSON.stringify({
    enabledModels: ["switcher/**"],
    modelRoles: { default: selector, smol: selector, slow: selector, plan: selector },
  }, null, 2) + "\n", { mode: 0o600, flag: "wx" });

  const env: Record<string, string> = {
    PI_CODING_AGENT_DIR: agentDir,
    [KEY]: input.credential ?? "switcher-local-no-auth",
  };
  const warnings = [
    "OMP uses an isolated per-launch models.yml/config.yml and provider-qualified model selection.",
    "OMP sessions use a stable Switcher-owned --session-dir; credentials exist only in the child environment.",
    "Native OMP project instructions and permissions remain enabled; model, profile and config overrides are reserved by Switcher.",
  ];
  return {
    executable: input.executable ?? "omp",
    args: ["--model", selector, "--models", "switcher/**", "--session-dir", sessionDir, ...(input.args ?? [])],
    env,
    configPaths: [modelsPath, configPath],
    warnings,
    cleanup: async () => { await rm(agentDir, { recursive: true, force: true }); },
  };
}
