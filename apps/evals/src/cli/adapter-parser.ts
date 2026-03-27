import type { AdapterConfig } from "../types/index.js";

export function parseAdapterConfig(opts: Record<string, string>): AdapterConfig {
  const type = opts["adapter"] ?? "http";

  switch (type) {
    case "http":
      if (!opts["url"]) throw new Error("--url is required for http adapter");
      return { type: "http", url: opts["url"] };
    case "anthropic":
      if (!opts["model"]) throw new Error("--model is required for anthropic adapter");
      return { type: "anthropic", model: opts["model"], systemPrompt: opts["system"] };
    case "openai":
      if (!opts["model"]) throw new Error("--model is required for openai adapter");
      return { type: "openai", model: opts["model"], systemPrompt: opts["system"] };
    case "function":
      if (!opts["module"]) throw new Error("--module is required for function adapter");
      return { type: "function", modulePath: opts["module"], exportName: opts["export"] };
    case "cli":
      if (!opts["command"]) throw new Error("--command is required for cli adapter");
      return { type: "cli", command: opts["command"] };
    case "mcp":
      if (!opts["mcpCommand"]) throw new Error("--mcp-command is required for mcp adapter");
      if (!opts["tool"]) throw new Error("--tool is required for mcp adapter");
      return {
        type: "mcp",
        command: opts["mcpCommand"].split(" "),
        tool: opts["tool"],
      };
    default:
      throw new Error(`Unknown adapter type: ${type}. Use: http|anthropic|openai|mcp|function|cli`);
  }
}
