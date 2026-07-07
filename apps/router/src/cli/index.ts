#!/usr/bin/env bun
import { analyzePrompt } from "../analysis";
import { loadRouterConfig, validateRouterConfig } from "../config";
import { routePrompt } from "../router";
import { startRouterServer } from "../server";
import { routerVersion } from "../version";
import type { RoutePromptRequest, RouterPriority, RouterTaskType } from "../types";

type ParsedArgs = {
  command: string;
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return { command, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string, fallback: string): string {
  const value = flags[key];
  return typeof value === "string" ? value : fallback;
}

function flagNumber(flags: Record<string, string | boolean>, key: string, fallback: number): number {
  const value = flags[key];
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function routeRequestFromFlags(flags: Record<string, string | boolean>): RoutePromptRequest {
  const prompt = flagString(flags, "prompt", "Explain what makes a model router useful.");
  return {
    model: flagString(flags, "model", "auto"),
    messages: [{ role: "user", content: prompt }],
    hints: {
      ...(typeof flags.task === "string" ? { task: flags.task as RouterTaskType } : {}),
      ...(typeof flags.priority === "string" ? { priority: flags.priority as RouterPriority } : {}),
      ...(typeof flags["cost-quality-tradeoff"] === "string"
        ? { costQualityTradeoff: flagNumber(flags, "cost-quality-tradeoff", 5) }
        : {}),
      ...(typeof flags.session === "string" ? { stickySessionId: flags.session } : {}),
    },
  };
}

function help(): string {
  return `open-router ${routerVersion}

Usage:
  open-router route --config router.config.json [--model auto] [--task coding] [--priority quality] --prompt "..."
  open-router analyze --prompt "..."
  open-router validate --config router.config.json
  open-router smoke --config router.config.json
  open-router serve --config router.config.json [--host 127.0.0.1] [--port 8797]
  open-router help
`;
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const configPath = flagString(parsed.flags, "config", "router.config.json");

  if (parsed.command === "help" || parsed.flags.help) {
    console.log(help());
    return;
  }

  if (parsed.command === "analyze") {
    const request = routeRequestFromFlags(parsed.flags);
    console.log(JSON.stringify(analyzePrompt(request), null, 2));
    return;
  }

  if (parsed.command === "validate") {
    const raw = JSON.parse(await Bun.file(configPath).text()) as unknown;
    const result = validateRouterConfig(raw);
    if (!result.ok) {
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
      return;
    }
    for (const warning of result.warnings) console.warn(warning);
    console.log(`Config ${configPath} is valid.`);
    return;
  }

  if (parsed.command === "route" || parsed.command === "smoke") {
    const config = await loadRouterConfig(configPath);
    const request =
      parsed.command === "smoke"
        ? {
            model: "auto",
            messages: [{ role: "user" as const, content: "Implement a retry helper in TypeScript and return JSON tests." }],
            hints: { priority: "balanced" as const, stickySessionId: "smoke" },
            response_format: { type: "json_object" },
          }
        : routeRequestFromFlags(parsed.flags);
    const decision = routePrompt({ config, request });
    if (parsed.flags.json || parsed.command === "smoke") {
      console.log(JSON.stringify(decision, null, 2));
    } else if (decision.selected) {
      console.log(`${decision.selected.model.id} via ${decision.selected.provider.id}`);
      console.log(decision.reason);
    } else {
      console.error(decision.reason);
    }
    if (decision.status !== "selected") process.exitCode = 1;
    return;
  }

  if (parsed.command === "serve") {
    const config = await loadRouterConfig(configPath);
    const host = flagString(parsed.flags, "host", "127.0.0.1");
    const port = flagNumber(parsed.flags, "port", 8797);
    const server = startRouterServer({ config, host, port });
    console.log(`open-router listening on http://${server.hostname}:${server.port}`);
    return;
  }

  console.log(help());
  process.exitCode = 1;
}

if (import.meta.main) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
