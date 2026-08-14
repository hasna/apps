import type { AdapterConfig, EvalRun } from "../types/index.js";

export function redactAdapterConfig(config: AdapterConfig | undefined): AdapterConfig | undefined {
  if (!config || !("apiKey" in config)) return config;

  const { apiKey: _apiKey, ...safeConfig } = config;
  return safeConfig as AdapterConfig;
}

export function redactRunSecrets(run: EvalRun): EvalRun {
  return {
    ...run,
    adapterConfig: redactAdapterConfig(run.adapterConfig),
  };
}
