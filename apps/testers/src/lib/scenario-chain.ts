import type { Scenario, Result } from "../types/index.js";

/**
 * Extract data from a scenario's result that can be used as input
 * for chained scenarios. This captures URLs, text content, form values,
 * or any data the scenario produced.
 */
export interface ChainOutput {
  /** The scenario that produced this output */
  scenarioId: string;
  scenarioName: string;
  /** Extracted data key-value pairs */
  data: Record<string, string>;
  /** URL the scenario ended on */
  finalUrl?: string;
  /** Whether the scenario passed (only passed scenarios produce valid output) */
  passed: boolean;
}

/**
 * Chain configuration: links one scenario's output to another's input.
 */
export interface ChainLink {
  /** The source scenario ID whose output will be used */
  sourceId: string;
  /** The target scenario ID that will receive the input */
  targetId: string;
  /** Mapping: { targetParam: sourceDataKey } */
  mapping: Record<string, string>;
}

/**
 * Extract chainable output from a scenario result.
 * Uses reasoning text, final URL, and result data as output sources.
 */
export function extractChainOutput(result: Result, scenarioName: string): ChainOutput {
  const data: Record<string, string> = {};

  if (result.reasoning) {
    // Extract key-value patterns like "found user ID: 12345" or "extracted name: John"
    // Use non-greedy match for the key and capture value to end of sentence/line
    const kvRegex = /(?:found|extracted|captured|got)\s+(?:the\s+)?([^:]+?):\s*([^.\n]+)/gi;
    let match;
    while ((match = kvRegex.exec(result.reasoning)) !== null) {
      const key = match[1]!.trim().replace(/\s+/g, "_").toLowerCase();
      data[key] = match[2]!.trim();
    }
  }

  return {
    scenarioId: result.scenarioId,
    scenarioName,
    data,
    passed: result.status === "passed",
  };
}

/**
 * Build a parameterized scenario by merging chain output into
 * the target scenario's steps and parameters.
 */
export function applyChainOutput(
  scenario: Scenario,
  chainData: Record<string, string>,
): Scenario {
  if (Object.keys(chainData).length === 0) return scenario;

  // Replace placeholders in steps (e.g., {{userId}}, {{orderId}})
  const interpolatedSteps = scenario.steps.map((step) => {
    let result = step;
    for (const [key, value] of Object.entries(chainData)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
    return result;
  });

  // Also interpolate description
  let description = scenario.description;
  for (const [key, value] of Object.entries(chainData)) {
    description = description.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  // Merge chain data into parameters
  const parameters = { ...scenario.parameters, ...chainData };

  return { ...scenario, steps: interpolatedSteps, description, parameters };
}

/**
 * Resolve a chain of scenarios, applying outputs from each passed
 * scenario to its downstream dependents.
 * Returns the ordered list of scenarios with chain data applied.
 */
export function resolveChain(
  scenarios: Scenario[],
  results: Result[],
  links: ChainLink[],
): { scenario: Scenario; sourceOutput?: ChainOutput }[] {
  const outputMap = new Map<string, ChainOutput>();

  // Build output map from results
  for (const result of results) {
    const scenario = scenarios.find((s) => s.id === result.scenarioId);
    if (scenario) {
      outputMap.set(scenario.id, extractChainOutput(result, scenario.name));
    }
  }

  // Apply chain links
  const resolved: { scenario: Scenario; sourceOutput?: ChainOutput }[] = [];
  const applied = new Set<string>();

  for (const link of links) {
    const sourceOutput = outputMap.get(link.sourceId);
    if (!sourceOutput || !sourceOutput.passed) continue;

    const targetScenario = scenarios.find((s) => s.id === link.targetId);
    if (!targetScenario || applied.has(link.targetId)) continue;

    // Map source data keys to target scenario parameters
    const chainData: Record<string, string> = {};
    for (const [targetKey, sourceKey] of Object.entries(link.mapping)) {
      if (sourceOutput.data[sourceKey]) {
        chainData[targetKey] = sourceOutput.data[sourceKey];
      }
    }

    if (Object.keys(chainData).length > 0) {
      resolved.push({
        scenario: applyChainOutput(targetScenario, chainData),
        sourceOutput,
      });
      applied.add(link.targetId);
    }
  }

  return resolved;
}

/**
 * Check if a scenario has chain dependencies.
 */
export function hasChainDependency(scenario: Scenario): boolean {
  return scenario.steps.some((step) => /\{\{[\w]+\}\}/.test(step));
}
