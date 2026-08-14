// Token estimation utility — shared across all modules
// Uses content-aware heuristic: code/JSON averages ~3.3 chars/token,
// English prose averages ~4.2 chars/token.

/** Detect if content is primarily code/JSON vs English prose */
function isCodeLike(text: string): boolean {
  // Count structural characters common in code/JSON
  const structural = (text.match(/[{}[\]();:=<>,"'`|&\\/@#$%^*+~!?]/g) || []).length;
  const ratio = structural / Math.max(text.length, 1);
  return ratio > 0.08; // >8% structural chars = code-like
}

/** Estimate token count for a string with content-aware heuristic */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const charsPerToken = isCodeLike(text) ? 3.3 : 4.2;
  return Math.ceil(text.length / charsPerToken);
}
