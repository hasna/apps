import type { OmpDocument, OmpError, OmpExecutionPlan, OmpExecutionResult } from "../types/index.js";

export const DEFAULT_OUTPUT_LIMIT = 20;
const MAX_ITEM_LENGTH = 80;
const MAX_LIST_ITEMS = 6;

export interface CompactOptions {
  limit?: number;
  verbose?: boolean;
  includeHint?: boolean;
}

export function normalizeLimit(value: unknown, fallback: number = DEFAULT_OUTPUT_LIMIT): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 1) return value;
    throw new Error(`Invalid limit value: ${value}. Expected a positive integer.`);
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`Invalid limit value: ${value}. Expected a positive integer.`);
  }
  const parsed = Number.parseInt(text, 10);
  if (parsed < 1) {
    throw new Error(`Invalid limit value: ${value}. Expected a positive integer.`);
  }
  return parsed;
}

export function summarizeDocument(doc: OmpDocument, plan: OmpExecutionPlan, options: CompactOptions = {}): string {
  const limit = options.verbose ? Number.POSITIVE_INFINITY : options.limit ?? DEFAULT_OUTPUT_LIMIT;
  const lines = [
    `Title: ${doc.title || "(untitled)"}`,
    `Cards: ${doc.cards.length} | Patterns: ${doc.patterns.length} | Steps: ${plan.steps.length}`,
    "",
    "Cards:",
  ];

  const visibleCards = doc.cards.slice(0, limit);
  for (const card of visibleCards) {
    const deps = card.depends.length > 0 ? ` deps=[${summarizeList(card.depends, options.verbose)}]` : "";
    const accepts = card.accepts.length > 0 ? ` accepts=${card.accepts.length}` : "";
    const directives = card.body.inlineDirectives.length > 0 ? ` inline=${card.body.inlineDirectives.length}` : "";
    const headers = options.verbose ? ` headers=[${Object.keys(card.headers).join(", ") || "none"}]` : "";
    lines.push(`  ${card.type}:${truncate(card.id)}${deps}${accepts}${directives}${headers}`);
  }

  appendTruncationHint(lines, doc.cards.length, visibleCards.length, "cards");
  lines.push("");
  lines.push(...summarizeExecutionPlan(plan, { ...options, includeHint: false }).split("\n"));
  lines.push("Hint: use --verbose for all rows, --limit <n> to adjust rows, or --json for full machine-readable details.");

  return lines.join("\n");
}

export function summarizeExecutionPlan(plan: OmpExecutionPlan, options: CompactOptions = {}): string {
  const limit = options.verbose ? Number.POSITIVE_INFINITY : options.limit ?? DEFAULT_OUTPUT_LIMIT;
  const lines = [`Execution Plan: ${plan.steps.length} steps, ${plan.totalCards} cards`];
  const visibleSteps = plan.steps.slice(0, limit);

  for (let i = 0; i < visibleSteps.length; i++) {
    const step = visibleSteps[i];
    lines.push(`  ${i + 1}. ${summarizeList(step.parallel, options.verbose)}${step.parallel.length > 1 ? " (parallel)" : ""}`);
  }

  appendTruncationHint(lines, plan.steps.length, visibleSteps.length, "steps");
  if (options.includeHint !== false) {
    lines.push("Hint: use --verbose for all steps, --limit <n> to adjust rows, or --json for the full plan.");
  }
  return lines.join("\n");
}

export function summarizeExecutionResult(result: OmpExecutionResult, options: CompactOptions = {}): string {
  const limit = options.verbose ? Number.POSITIVE_INFINITY : options.limit ?? DEFAULT_OUTPUT_LIMIT;
  const status = result.success ? "Execution complete" : "Execution failed";
  const lines = [
    `${status}: ${result.cardsExecuted}/${result.cardsTotal} cards, ${result.llmCalls} LLM calls, ${result.durationMs}ms`,
    `Files created: ${result.filesCreated.length} | Commands run: ${result.commandsRun.length} | Errors: ${result.errors.length}`,
  ];

  const visibleErrors = result.errors.slice(0, limit);
  if (visibleErrors.length > 0) {
    lines.push("Errors:");
    for (const err of visibleErrors) {
      const loc = err.card ? ` [${err.card}]` : "";
      const line = err.line ? `:${err.line}` : "";
      lines.push(`  ${err.level.toUpperCase()}${loc}${line}: ${truncate(err.message)}`);
    }
    appendTruncationHint(lines, result.errors.length, visibleErrors.length, "errors");
  }

  if (options.verbose) {
    appendVerboseList(lines, "Files", result.filesCreated);
    appendVerboseList(lines, "Commands", result.commandsRun);
  } else if (result.filesCreated.length > 0 || result.commandsRun.length > 0) {
    lines.push("Hint: use --verbose for file/command details or --json for the full result.");
  } else {
    lines.push("Hint: use --json for the full result.");
  }

  return lines.join("\n");
}

export function summarizeIssues(
  label: string,
  counts: { cards: number; errors: number; warnings: number; info?: number },
  issues: OmpError[],
  options: CompactOptions = {}
): string {
  const limit = options.verbose ? Number.POSITIVE_INFINITY : options.limit ?? DEFAULT_OUTPUT_LIMIT;
  const parts = [
    `${label}: ${counts.cards} cards`,
    `${counts.errors} errors`,
    `${counts.warnings} warnings`,
  ];
  if (counts.info !== undefined) parts.push(`${counts.info} info`);

  const lines = [parts.join(" | ")];
  const visibleIssues = issues.slice(0, limit);
  for (const issue of visibleIssues) {
    const loc = issue.card ? ` [${issue.card}]` : "";
    const line = issue.line ? `:${issue.line}` : "";
    lines.push(`  ${issue.level.toUpperCase()}${loc}${line}: ${truncate(issue.message)}`);
  }
  appendTruncationHint(lines, issues.length, visibleIssues.length, "issues");
  lines.push("Hint: pass verbose=true for all issues, limit=<n> to adjust rows, or json=true for full machine-readable output.");
  return lines.join("\n");
}

export function summarizeAgents(
  agents: Array<{ id: string; name: string; last_seen_at: string; project_id?: string }>,
  options: CompactOptions = {}
): string {
  if (agents.length === 0) return "No agents registered.";

  const limit = options.verbose ? Number.POSITIVE_INFINITY : options.limit ?? DEFAULT_OUTPUT_LIMIT;
  const lines = [`Agents: ${agents.length}`];
  const visibleAgents = agents.slice(0, limit);
  for (const agent of visibleAgents) {
    const focus = agent.project_id ? ` focus=${truncate(agent.project_id, 40)}` : "";
    const seen = options.verbose ? ` last_seen=${agent.last_seen_at}` : "";
    lines.push(`  ${agent.id} ${truncate(agent.name, 40)}${focus}${seen}`);
  }
  appendTruncationHint(lines, agents.length, visibleAgents.length, "agents");
  lines.push("Hint: pass verbose=true for timestamps and all rows.");
  return lines.join("\n");
}

function summarizeList(items: string[], verbose: boolean | undefined): string {
  const visible = verbose ? items : items.slice(0, MAX_LIST_ITEMS);
  const suffix = !verbose && items.length > visible.length ? `, +${items.length - visible.length} more` : "";
  return `${visible.map((item) => truncate(item)).join(", ")}${suffix}`;
}

function appendVerboseList(lines: string[], title: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push(`${title}:`);
  for (const item of items) {
    lines.push(`  ${truncate(item)}`);
  }
}

function appendTruncationHint(lines: string[], total: number, visible: number, label: string): void {
  if (total > visible) {
    lines.push(`  ... ${total - visible} more ${label} not shown`);
  }
}

function truncate(value: string, maxLength: number = MAX_ITEM_LENGTH): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
