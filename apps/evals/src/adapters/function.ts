import type { FunctionAdapterConfig } from "../types/index.js";
import type { AdapterResponse } from "./http.js";

export async function callFunctionAdapter(
  config: FunctionAdapterConfig,
  input: string
): Promise<AdapterResponse> {
  const start = Date.now();

  try {
    const mod = await import(config.modulePath) as Record<string, unknown>;
    const exportName = config.exportName ?? "default";
    const fn = mod[exportName];

    if (typeof fn !== "function") {
      return {
        output: "",
        durationMs: Date.now() - start,
        error: `Export "${exportName}" in "${config.modulePath}" is not a function`,
      };
    }

    const result = await (fn as (input: string) => Promise<unknown>)(input);
    const output = typeof result === "string" ? result : JSON.stringify(result);

    return { output, durationMs: Date.now() - start };
  } catch (err) {
    return {
      output: "",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
