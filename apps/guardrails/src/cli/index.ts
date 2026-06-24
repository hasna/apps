#!/usr/bin/env bun
import { defaultGuardrailPolicySet } from "../default-policy";
import { evaluateGuardrail } from "../evaluator";
import { loadGuardrailInput, loadPolicySet, validatePolicySet } from "../policy-loader";
import { parseGuardrailInput } from "../schemas";
import type { GuardrailDecision, GuardrailPolicySet } from "../types";
import { guardrailsVersion } from "../version";

type ParsedArgs = {
  command: string;
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg?.startsWith("--")) continue;
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
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${key} must be a non-negative integer.`);
  return parsed;
}

function optionalFlagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

async function readJsonFromStdin(): Promise<unknown> {
  return JSON.parse(await Bun.stdin.text());
}

function truncate(value: string, maxLength = 140): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function slicePage<T>(items: T[], cursor: number, limit: number): { items: T[]; nextCursor?: number } {
  const start = Math.min(cursor, items.length);
  const end = Math.min(start + limit, items.length);
  const page = items.slice(start, end);
  return end < items.length ? { items: page, nextCursor: end } : { items: page };
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function statusIcon(status: GuardrailDecision["status"]): string {
  if (status === "allow") return "ALLOW";
  if (status === "deny") return "DENY";
  if (status === "warn") return "WARN";
  if (status === "redact") return "REDACT";
  return "APPROVAL";
}

function compactDecisionLines(decision: GuardrailDecision, options: { limit: number; cursor: number }): string[] {
  const lines = [
    `${statusIcon(decision.status)} ${decision.status}: ${truncate(decision.reason)}`,
    [
      plural(decision.matchedPolicies.length, "policy", "policies"),
      plural(decision.evidence.length, "evidence item"),
      plural(decision.obligations.length, "obligation"),
      plural(decision.redactions.length, "redaction"),
      plural(decision.approvalRequirements.length, "approval"),
    ].join(" | "),
  ];

  const policyPage = slicePage(decision.matchedPolicies, options.cursor, Math.max(1, options.limit));
  if (policyPage.items.length > 0) {
    lines.push(`matched: ${policyPage.items.map((policy) => `${policy.id}:${policy.effect}`).join(", ")}`);
    if (policyPage.nextCursor !== undefined) lines.push(`more: use --cursor ${policyPage.nextCursor} to continue matched policies`);
  }

  const detailHint =
    decision.matchedPolicies.length > 0 || decision.redactions.length > 0 || decision.approvalRequirements.length > 0
      ? "details: use --verbose or guardrails inspect --input <file> for evidence, obligations, redactions, approvals, and audit metadata."
      : "details: use --verbose for audit metadata or --json for the stable machine-readable decision.";
  lines.push(detailHint);
  return lines;
}

function section<T>(
  title: string,
  items: T[],
  options: { limit: number; cursor: number },
  render: (item: T, index: number) => string,
): string[] {
  if (items.length === 0) return [`${title}: none`];
  const page = slicePage(items, options.cursor, Math.max(1, options.limit));
  if (page.items.length === 0 && options.cursor > 0) return [];
  const lines = [`${title}: showing ${page.items.length} of ${items.length}${options.cursor > 0 ? ` from ${options.cursor}` : ""}`];
  page.items.forEach((item, index) => lines.push(`  ${options.cursor + index + 1}. ${render(item, options.cursor + index)}`));
  if (page.nextCursor !== undefined) lines.push(`  more: rerun with --cursor ${page.nextCursor}`);
  return lines;
}

function verboseDecisionLines(decision: GuardrailDecision, options: { limit: number; cursor: number }): string[] {
  return [
    `${statusIcon(decision.status)} ${decision.status}`,
    `reason: ${truncate(decision.reason, 220)}`,
    `allowed: ${String(decision.allowed)}`,
    `audit: decision=${decision.audit.decisionId} policySet=${decision.audit.policySetId} operation=${decision.audit.operationType}`,
    ...section("matched policies", decision.matchedPolicies, options, (policy) =>
      `${policy.id} effect=${policy.effect} severity=${policy.severity} reason=${truncate(policy.reason, 160)}`,
    ),
    ...section("evidence", decision.evidence, options, (item) =>
      `${item.policyId} ${truncate(item.message, 180)}${item.path ? ` path=${item.path}` : ""}`,
    ),
    ...section("obligations", decision.obligations, options, (item) =>
      `${item.id}${item.stage ? ` stage=${item.stage}` : ""} ${truncate(item.description, 180)}`,
    ),
    ...section("redactions", decision.redactions, options, (item) =>
      `${item.policyId}${item.ruleId ? `/${item.ruleId}` : ""} path=${item.path} replacement=${item.replacement} sha256=${item.originalSha256.slice(0, 12)}…`,
    ),
    ...section("approvals", decision.approvalRequirements, options, (item) =>
      `${item.id ?? "approval"}${item.approverRoles?.length ? ` roles=${item.approverRoles.join(",")}` : ""}${item.ticketRequired ? " ticketRequired=true" : ""} ${truncate(item.reason ?? "", 160)}`,
    ),
    "json: use --json for the full stable machine-readable decision.",
  ];
}

function printDecision(
  decision: GuardrailDecision,
  flags: Record<string, string | boolean>,
  options: { forceVerbose?: boolean } = {},
): void {
  if (flags.json) {
    console.log(JSON.stringify(decision, null, 2));
    return;
  }
  const limit = Math.max(1, flagNumber(flags, "limit", 3));
  const cursor = flagNumber(flags, "cursor", 0);
  const verbose = options.forceVerbose === true || flags.verbose === true;
  const lines = verbose ? verboseDecisionLines(decision, { limit, cursor }) : compactDecisionLines(decision, { limit, cursor });
  console.log(lines.join("\n"));
}

function validationSummary(policySet: GuardrailPolicySet, policyPath: string, verbose: boolean): string {
  if (!verbose) return `Policy ${policyPath} is valid.`;
  const enabled = policySet.policies.filter((policy) => policy.enabled !== false).length;
  const disabled = policySet.policies.length - enabled;
  const effects = policySet.policies.reduce<Record<string, number>>((acc, policy) => {
    acc[policy.effect] = (acc[policy.effect] ?? 0) + 1;
    return acc;
  }, {});
  return [
    `Policy ${policyPath} is valid.`,
    `id: ${policySet.id}${policySet.version ? `@${policySet.version}` : ""}`,
    `policies: ${policySet.policies.length} (${enabled} enabled, ${disabled} disabled)`,
    `effects: ${Object.entries(effects).map(([effect, count]) => `${effect}=${count}`).join(", ")}`,
  ].join("\n");
}

function help(): string {
  return `open-guardrails ${guardrailsVersion}

Usage:
  guardrails evaluate --input request.json [--policy guardrails.policy.json] [--verbose] [--limit 3] [--cursor 0] [--json]
  guardrails evaluate --stdin [--policy guardrails.policy.json] [--verbose] [--json]
  guardrails inspect --input request.json [--policy guardrails.policy.json] [--limit 10] [--cursor 0] [--json]
  guardrails show --input request.json [--policy guardrails.policy.json] [--limit 10] [--cursor 0] [--json]
  guardrails validate --policy guardrails.policy.json [--verbose]
  guardrails version
  guardrails help

Defaults are compact for humans and agents. Use inspect/show or --verbose for details.
Use --json for the full stable machine-readable decision object.
`;
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.command === "help" || parsed.flags.help) {
    console.log(help());
    return;
  }

  if (parsed.command === "version") {
    console.log(guardrailsVersion);
    return;
  }

  if (parsed.command === "validate") {
    const policyPath = optionalFlagString(parsed.flags, "policy");
    if (!policyPath) throw new Error("--policy is required for validate.");
    const raw = await loadGuardrailInput(policyPath);
    const result = validatePolicySet(raw);
    if (!result.ok) {
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
      return;
    }
    console.log(validationSummary(result.policySet, policyPath, parsed.flags.verbose === true));
    return;
  }

  if (parsed.command === "evaluate" || parsed.command === "inspect" || parsed.command === "show") {
    const policyPath = optionalFlagString(parsed.flags, "policy");
    const policySet = policyPath ? await loadPolicySet(policyPath) : defaultGuardrailPolicySet;
    const inputPath = optionalFlagString(parsed.flags, "input");
    if (!parsed.flags.stdin && !inputPath) throw new Error("--input is required unless --stdin is used.");
    const rawInput = parsed.flags.stdin ? await readJsonFromStdin() : await loadGuardrailInput(inputPath!);
    const input = parseGuardrailInput(rawInput);
    const decision = evaluateGuardrail(input, policySet);
    printDecision(decision, parsed.flags, { forceVerbose: parsed.command === "inspect" || parsed.command === "show" });
    if (!decision.allowed) process.exitCode = decision.status === "approval_required" ? 2 : 1;
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
