/**
 * Global output stripping middleware.
 *
 * When strip is enabled in the connectors data root's llm.json, every output surface
 * (MCP, REST, CLI) passes through maybeStrip() before returning to the caller.
 * This reduces token consumption for AI agents consuming connector output.
 *
 * If strip is disabled or no LLM config exists, output is returned as-is.
 */

import { getLlmConfig, LLMClient } from "./llm.js";

const STRIP_PROMPT = `You are a data extraction assistant. Your job is to take raw API output and return ONLY the essential, structured data.

Rules:
- Return valid JSON only (no markdown, no explanation)
- Remove pagination metadata, rate limit headers, empty fields, null values
- Keep all meaningful data fields
- If the input is already minimal, return it unchanged
- If input is not JSON, extract key facts as a JSON object
- Never truncate actual data values`;

export type StripType = "json" | "text";

/**
 * Conditionally strip output through LLM if strip is enabled.
 * Returns output unchanged if strip is disabled or LLM not configured.
 */
export async function maybeStrip(
  output: string,
  _type: StripType = "json"
): Promise<string> {
  const config = getLlmConfig();
  if (!config?.strip) return output;
  if (!output || output.trim().length === 0) return output;

  const client = LLMClient.fromConfig();
  if (!client) return output;

  try {
    const result = await client.complete(STRIP_PROMPT, output);
    return result.content.trim();
  } catch {
    // Stripping failed — return original output rather than crashing
    return output;
  }
}

/**
 * Synchronous passthrough check — returns true if stripping is active.
 * Use this to decide whether to await maybeStrip or skip it.
 */
export function isStrippingActive(): boolean {
  return getLlmConfig()?.strip === true;
}
