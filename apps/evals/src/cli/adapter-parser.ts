import type { AdapterConfig, HttpAdapterConfig } from "../types/index.js";

function parsePositiveInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--headers must be a JSON object");
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, headerValue]) => {
      if (typeof headerValue !== "string") {
        throw new Error("--headers values must be strings");
      }
      return [key, headerValue];
    })
  );
}

function parseHttpMethod(value: string | undefined): HttpAdapterConfig["method"] | undefined {
  if (!value) return undefined;
  const method = value.toUpperCase();
  if (method === "GET" || method === "POST" || method === "PUT" || method === "PATCH") {
    return method;
  }
  throw new Error("--method must be GET, POST, PUT, or PATCH");
}

function parseResponseMode(value: string | undefined): HttpAdapterConfig["responseMode"] | undefined {
  if (!value) return undefined;
  if (value === "json" || value === "text") return value;
  throw new Error("--response-mode must be json or text");
}

export function parseAdapterConfig(opts: Record<string, string>): AdapterConfig {
  const type = opts["adapter"] ?? "http";
  const apiKey = opts["apiKey"] ?? (opts["apiKeyEnv"] ? process.env[opts["apiKeyEnv"]] : undefined);

  switch (type) {
    case "http":
      if (!opts["url"]) throw new Error("--url is required for http adapter");
      return {
        type: "http",
        url: opts["url"],
        method: parseHttpMethod(opts["method"]),
        headers: parseHeaders(opts["headers"]),
        responseMode: parseResponseMode(opts["responseMode"]),
        inputPath: opts["inputPath"],
        outputPath: opts["outputPath"],
        timeoutMs: parsePositiveInteger(opts["timeoutMs"], "--timeout-ms"),
      };
    case "anthropic":
      if (!opts["model"]) throw new Error("--model is required for anthropic adapter");
      const anthropicMaxTokens = parsePositiveInteger(opts["maxTokens"], "--max-tokens");
      return {
        type: "anthropic",
        model: opts["model"],
        systemPrompt: opts["system"],
        ...(anthropicMaxTokens ? { maxTokens: anthropicMaxTokens } : {}),
        ...(apiKey ? { apiKey } : {}),
      };
    case "openai":
      if (!opts["model"]) throw new Error("--model is required for openai adapter");
      const openAIMaxTokens = parsePositiveInteger(opts["maxTokens"], "--max-tokens");
      return {
        type: "openai",
        model: opts["model"],
        systemPrompt: opts["system"],
        ...(openAIMaxTokens ? { maxTokens: openAIMaxTokens } : {}),
        baseURL: opts["baseUrl"] ?? opts["url"],
        ...(apiKey ? { apiKey } : {}),
      };
    case "function":
      if (!opts["module"]) throw new Error("--module is required for function adapter");
      return { type: "function", modulePath: opts["module"], exportName: opts["export"] };
    case "cli":
      if (!opts["command"]) throw new Error("--command is required for cli adapter");
      return {
        type: "cli",
        command: opts["command"],
        timeoutMs: parsePositiveInteger(opts["timeoutMs"], "--timeout-ms"),
      };
    case "mcp":
      if (!opts["mcpCommand"]) throw new Error("--mcp-command is required for mcp adapter");
      if (!opts["tool"]) throw new Error("--tool is required for mcp adapter");
      return {
        type: "mcp",
        command: opts["mcpCommand"].split(" "),
        tool: opts["tool"],
        timeoutMs: parsePositiveInteger(opts["timeoutMs"], "--timeout-ms"),
      };
    default:
      throw new Error(`Unknown adapter type: ${type}. Use: http|anthropic|openai|mcp|function|cli`);
  }
}
