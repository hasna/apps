#!/usr/bin/env bun
import { analyzePrompt } from "../analysis";
import { loadRouterConfig, validateRouterConfig } from "../config";
import { routePrompt } from "../router";
import { startRouterServer } from "../server";
import { routerVersion } from "../version";
import type { PromptAnalysis, RoutePromptRequest, RouterDecision, RouterPriority, RouterScore, RouterTaskType } from "../types";

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
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex > 2) {
      flags[arg.slice(2, equalsIndex)] = arg.slice(equalsIndex + 1);
      continue;
    }
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

function flagBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}

const commonFlags = new Set(["help", "json", "verbose", "compact", "limit"]);
const routeFlags = new Set([
  "config",
  "model",
  "prompt",
  "task",
  "priority",
  "cost-quality-tradeoff",
  "session",
  ...commonFlags,
]);
const analyzeFlags = new Set(["model", "prompt", "task", "priority", "cost-quality-tradeoff", "session", ...commonFlags]);
const validateFlags = new Set(["config", "help"]);
const serveFlags = new Set(["config", "host", "port", "help"]);
const smokeFlags = new Set(["config", ...commonFlags]);

function flagsForCommand(command: string): Set<string> | undefined {
  if (command === "route" || command === "inspect" || command === "show") return routeFlags;
  if (command === "analyze") return analyzeFlags;
  if (command === "validate") return validateFlags;
  if (command === "serve") return serveFlags;
  if (command === "smoke") return smokeFlags;
  if (command === "help") return commonFlags;
  return undefined;
}

function rejectUnknownFlags(command: string, flags: Record<string, string | boolean>): boolean {
  const known = flagsForCommand(command);
  if (!known) return false;
  const unknown = Object.keys(flags).filter((flag) => !known.has(flag));
  if (!unknown.length) return false;
  console.error(`Unknown flag${unknown.length === 1 ? "" : "s"} for ${command}: ${unknown.map((flag) => `--${flag}`).join(", ")}`);
  console.error("Run `open-router help` for supported compact, verbose, and JSON output modes.");
  process.exitCode = 1;
  return true;
}

function outputLimit(flags: Record<string, string | boolean>): number {
  const value = Math.floor(flagNumber(flags, "limit", 5));
  return Math.max(1, Math.min(value, 50));
}

function compactList(values: string[], fallback = "none"): string {
  return values.length ? values.join(", ") : fallback;
}

function truncate(value: string, maxLength = 120): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatScore(score: number): string {
  return score.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatComponents(score: RouterScore): string {
  return Object.entries(score.components)
    .filter(([, value]) => value !== 0)
    .map(([name, value]) => `${name}=${formatScore(value)}`)
    .join(", ");
}

function topScores(decision: RouterDecision, limit: number): RouterScore[] {
  return decision.scores.slice(0, limit);
}

function formatCompactDecision(decision: RouterDecision, options: { limit: number; label?: string }): string {
  const lines: string[] = [];
  const prefix = options.label ? `${options.label}: ` : "";

  if (decision.status === "selected" && decision.selected) {
    const selectedScore = decision.scores.find((score) => score.model === decision.selectedId);
    lines.push(`${prefix}selected ${decision.selected.model.id} via ${decision.selected.provider.id}`);
    lines.push(`mode=${decision.mode} task=${decision.analysis.primaryTask} reason=${truncate(decision.reason, 96)}`);
    if (selectedScore) lines.push(`score=${formatScore(selectedScore.score)} candidates=${decision.orderedCandidates.length} skipped=${decision.skipped.length}`);
  } else {
    lines.push(`${prefix}no route`);
    lines.push(`mode=${decision.mode} task=${decision.analysis.primaryTask} reason=${truncate(decision.reason, 96)}`);
    lines.push(`resolved=${decision.resolvedCandidates.length} skipped=${decision.skipped.length}`);
  }

  const scores = topScores(decision, options.limit);
  if (scores.length) {
    const rendered = scores.map((score) => `${score.model}:${formatScore(score.score)}`);
    const remainder = decision.scores.length - scores.length;
    lines.push(`top_scores=${rendered.join(" | ")}${remainder > 0 ? ` (+${remainder} more)` : ""}`);
  }

  if (decision.skipped.length) {
    const skipped = decision.skipped.slice(0, options.limit).map((skip) => `${skip.model}: ${truncate(skip.reason, 64)}`);
    const remainder = decision.skipped.length - skipped.length;
    lines.push(`skipped=${skipped.join(" | ")}${remainder > 0 ? ` (+${remainder} more)` : ""}`);
  }

  lines.push("details: use --verbose for score components or --json for the full decision object");
  return lines.join("\n");
}

function formatVerboseDecision(decision: RouterDecision, limit: number): string {
  const lines = [formatCompactDecision(decision, { limit })];
  lines.push("");
  lines.push(`analysis: tasks=${compactList(decision.analysis.taskTypes)} capabilities=${compactList(decision.analysis.requiredCapabilities)}`);
  lines.push(
    `tokens: input_estimate=${decision.analysis.estimatedInputTokens} output_estimate=${decision.analysis.estimatedOutputTokens} complexity=${formatScore(decision.analysis.complexity)}`,
  );
  if (decision.sourceHints.length) lines.push(`source_hints: ${decision.sourceHints.map((hint) => truncate(hint, 88)).join(" | ")}`);

  if (decision.scores.length) {
    lines.push("");
    lines.push(`scores (top ${Math.min(limit, decision.scores.length)} of ${decision.scores.length}):`);
    for (const [index, score] of topScores(decision, limit).entries()) {
      lines.push(`  ${index + 1}. ${score.model} via ${score.provider} score=${formatScore(score.score)}`);
      lines.push(`     ${truncate(score.reason, 120)}`);
      const components = formatComponents(score);
      if (components) lines.push(`     components: ${components}`);
    }
  }

  if (decision.skipped.length) {
    lines.push("");
    lines.push(`skipped (first ${Math.min(limit, decision.skipped.length)} of ${decision.skipped.length}):`);
    for (const skip of decision.skipped.slice(0, limit)) {
      lines.push(`  - ${skip.model} via ${skip.provider}: ${truncate(skip.reason, 120)}`);
    }
  }

  if (decision.safetyNotes.length) {
    lines.push("");
    lines.push("safety:");
    for (const note of decision.safetyNotes) lines.push(`  - ${truncate(note, 140)}`);
  }

  if (decision.gatewayHints) {
    lines.push("");
    lines.push("gateway_hints: available in --json output");
  }

  return lines.join("\n");
}

function formatCompactAnalysis(analysis: PromptAnalysis, options: { includeDetailHint?: boolean } = {}): string {
  const lines = [
    `task=${analysis.primaryTask} tasks=${compactList(analysis.taskTypes)}`,
    `capabilities=${compactList(analysis.requiredCapabilities)} tokens=input:${analysis.estimatedInputTokens},output:${analysis.estimatedOutputTokens} complexity=${formatScore(analysis.complexity)}`,
    analysis.sourceHints.length ? `hints=${analysis.sourceHints.map((hint) => truncate(hint, 88)).join(" | ")}` : "hints=none",
  ];
  if (options.includeDetailHint !== false) lines.push("details: use --verbose for task scores or --json for the full analysis object");
  return lines.join("\n");
}

function formatVerboseAnalysis(analysis: PromptAnalysis, limit: number): string {
  const scoreEntries = Object.entries(analysis.taskScores)
    .sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))
    .slice(0, limit)
    .map(([task, score]) => `${task}=${formatScore(score ?? 0)}`);
  return [
    formatCompactAnalysis(analysis, { includeDetailHint: false }),
    "",
    `task_scores=${scoreEntries.length ? scoreEntries.join(", ") : "none"}`,
    `prompt_chars=${analysis.promptLengthChars}`,
    `source_hints=${analysis.sourceHints.length ? analysis.sourceHints.map((hint) => truncate(hint, 120)).join(" | ") : "none"}`,
  ].join("\n");
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
  open-router inspect|show --config router.config.json --prompt "..." [--limit 10]
  open-router analyze --prompt "..."
  open-router validate --config router.config.json
  open-router smoke --config router.config.json
  open-router serve --config router.config.json [--host 127.0.0.1] [--port 8797]
  open-router help

Disclosure flags:
  --compact  Keep compact human output (default)
  --verbose  Show human-readable details without dumping full objects
  --json     Emit the full machine-readable object for route/analyze/smoke/inspect/show
  --limit N  Cap displayed score/skip rows in human output (default: 5)
`;
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const configPath = flagString(parsed.flags, "config", "router.config.json");

  if (rejectUnknownFlags(parsed.command, parsed.flags)) return;

  if (parsed.command === "help" || parsed.flags.help) {
    console.log(help());
    return;
  }

  if (parsed.command === "analyze") {
    const request = routeRequestFromFlags(parsed.flags);
    const analysis = analyzePrompt(request);
    if (flagBool(parsed.flags, "json")) console.log(JSON.stringify(analysis, null, 2));
    else if (flagBool(parsed.flags, "verbose")) console.log(formatVerboseAnalysis(analysis, outputLimit(parsed.flags)));
    else console.log(formatCompactAnalysis(analysis));
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

  if (parsed.command === "route" || parsed.command === "smoke" || parsed.command === "inspect" || parsed.command === "show") {
    const config = await loadRouterConfig(configPath);
    const detailCommand = parsed.command === "inspect" || parsed.command === "show";
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
    if (flagBool(parsed.flags, "json")) {
      console.log(JSON.stringify(decision, null, 2));
    } else if (flagBool(parsed.flags, "verbose") || detailCommand) {
      const output = formatVerboseDecision(decision, outputLimit(parsed.flags));
      if (decision.status === "selected") console.log(output);
      else console.error(output);
    } else {
      const output = formatCompactDecision(decision, {
        limit: outputLimit(parsed.flags),
        ...(parsed.command === "smoke" ? { label: "smoke ok" } : {}),
      });
      if (decision.status === "selected") console.log(output);
      else console.error(output);
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
