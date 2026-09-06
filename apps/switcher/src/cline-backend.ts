import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { codingEligible, endpoint } from "./domain";
import type { HarnessLaunchInput, PreparedLaunch } from "./harness-types";

const ENV_BY_PROTOCOL = {
  "anthropic-messages": "ANTHROPIC_API_KEY",
  "openai-responses": "OPENAI_API_KEY",
  "openai-chat": "OPENAI_API_KEY",
} as const;
const PROTOCOL = {
  "anthropic-messages": { protocol: "anthropic", client: "anthropic", providerId: "anthropic", authStyle: "x-api-key" },
  "openai-responses": { protocol: "openai-responses", client: "openai", providerId: "openai", authStyle: "bearer" },
  "openai-chat": { protocol: "openai-chat", client: "openai-compatible", providerId: "openai-compatible", authStyle: "bearer" },
} as const;

function modelEntry(model: HarnessLaunchInput["models"][number]) {
  return {
    id: model.id,
    name: model.name,
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutputTokens ? { maxTokens: model.maxOutputTokens } : {}),
    capabilities: ["streaming", "tools"],
    modalities: {
      input: model.inputModalities?.filter(modality => modality === "text" || modality === "image") ?? ["text"],
      output: model.outputModalities?.filter(modality => modality === "text") ?? ["text"],
    },
  };
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return path;
}

/**
 * Prepare Cline's native provider and model registries in an isolated data
 * directory. Cline resolves OPENAI_API_KEY/ANTHROPIC_API_KEY from the child
 * environment; no apiKey or auth token is written to either registry.
 */
export async function prepareClineLaunch(input: HarnessLaunchInput): Promise<PreparedLaunch> {
  const selected = input.models.find(model => model.id === input.model);
  if (!selected) throw new Error("Selected model is missing from the launch catalog.");
  if (input.models.some(model => !codingEligible(model))) throw new Error("Launch catalog contains a model explicitly ineligible for coding.");
  if (new Set(input.models.map(model => model.id.toLowerCase())).size !== input.models.length)
    throw new Error("Cline cannot safely select model IDs that differ only by letter case; update the provider catalog.");
  const mapping = PROTOCOL[input.protocol];
  if ((input.authStyle ?? "bearer") !== mapping.authStyle)
    throw new Error(`Cline ${input.protocol} uses ${mapping.authStyle} authentication; use a provider with the native Cline auth contract.`);
  if (input.credential && /[\r\n]/.test(input.credential)) throw new Error("Provider credential contains invalid header characters.");
  const dataDir = input.sessionDir ?? join(input.stateDir, "cline-data");
  const settingsDir = join(dataDir, "settings");
  const configDir = join(input.stateDir, "cline-config");
  await mkdir(settingsDir, { recursive: true, mode: 0o700 });
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const baseUrl = endpoint(input.baseUrl);
  const providerId = mapping.providerId;
  const providersPath = await writeJson(join(settingsDir, "providers.json"), {
    version: 1,
    lastUsedProvider: providerId,
    modes: {},
    providers: {
      [providerId]: {
        settings: {
          provider: providerId,
          model: input.model,
          protocol: mapping.protocol,
          client: mapping.client,
          baseUrl,
          capabilities: ["streaming", "tools"],
        },
        updatedAt: new Date().toISOString(),
        tokenSource: "manual",
      },
    },
  });
  const modelsPath = await writeJson(join(settingsDir, "models.json"), {
    version: 1,
    providers: {
      [providerId]: {
        provider: {
          name: "Switcher",
          baseUrl,
          defaultModelId: input.model,
          protocol: mapping.protocol,
          client: mapping.client,
        },
        models: Object.fromEntries(input.models.map(model => [model.id, modelEntry(model)])),
      },
    },
  });
  const credentialEnv = ENV_BY_PROTOCOL[input.protocol];
  return {
    executable: input.executable ?? "cline",
    args: [
      "--data-dir", dataDir,
      "--config", configDir,
      "--cwd", input.cwd,
      "--provider", providerId,
      "--model", input.model,
      "--auto-approve", "false",
      ...(input.args ?? []),
    ],
    env: {
      [credentialEnv]: input.credential ?? "switcher-local-no-auth",
      CLINE_PROVIDER_SETTINGS_PATH: providersPath,
    },
    configPaths: [providersPath, modelsPath],
    warnings: [
      "Cline uses an isolated provider/model registry and a stable session data directory; credentials remain in the child environment.",
      "Cline auto-approval is explicitly disabled for this launch; native project instructions and permission prompts remain active.",
    ],
  };
}
