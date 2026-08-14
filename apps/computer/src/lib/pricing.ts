/**
 * Pricing per 1M tokens for supported models.
 * Prices in USD. Updated March 2026.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-sonnet-4-5-20250514": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-opus-4-5": { input: 15, output: 75 },
  "claude-haiku-4-5": { input: 0.80, output: 4 },

  // OpenAI
  "computer-use-preview": { input: 3, output: 12 },
  "gpt-4o": { input: 2.50, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4.1": { input: 2, output: 8 },
  "o1": { input: 15, output: 60 },
};

/**
 * Calculate cost in USD for a given model and token counts.
 */
export function calculateCost(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const pricing = findPricing(model);
  const inputCost = (tokensIn / 1_000_000) * pricing.input;
  const outputCost = (tokensOut / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Format a cost as a human-readable string.
 */
export function formatCost(cost: number): string {
  if (cost < 0.001) return "<$0.001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Get step cost for display (tokens in this step → cost string).
 */
export function stepCost(
  model: string,
  tokensIn: number,
  tokensOut: number
): string {
  return formatCost(calculateCost(model, tokensIn, tokensOut));
}

/** Find pricing for a model, with fuzzy matching */
function findPricing(model: string): { input: number; output: number } {
  // Exact match
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  // Prefix match (e.g. "claude-sonnet-4-5-20250514" matches "claude-sonnet-4-5")
  const modelLower = model.toLowerCase();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelLower.startsWith(key.toLowerCase())) return pricing;
  }

  // Default: mid-range pricing
  return { input: 3, output: 12 };
}

/** Get all known model pricings */
export function listPricing(): Record<string, { input: number; output: number }> {
  return { ...MODEL_PRICING };
}
