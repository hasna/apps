/** Keep enough room for Claude's next turn and compaction request on DeepSeek.
 * https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/
 * Inspect the original provider URL: the native URL is a loopback gateway.
 */
export function claudeContextEnvironment(providerBaseUrl: string, environment: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const explicit = environment.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  if (explicit !== undefined) return { CLAUDE_CODE_AUTO_COMPACT_WINDOW: explicit };
  const provider = new URL(providerBaseUrl);
  if (provider.origin === "https://api.deepseek.com" && /^\/anthropic(?:\/v1)?\/?$/.test(provider.pathname))
    return { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "786432" };
  return {};
}
