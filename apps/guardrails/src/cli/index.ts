#!/usr/bin/env bun
import { defaultGuardrailPolicySet } from "../default-policy";
import { evaluateGuardrail } from "../evaluator";
import { loadGuardrailInput, loadPolicySet, validatePolicySet } from "../policy-loader";
import { parseGuardrailInput } from "../schemas";
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

function optionalFlagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

async function readJsonFromStdin(): Promise<unknown> {
  return JSON.parse(await Bun.stdin.text());
}

function help(): string {
  return `open-guardrails ${guardrailsVersion}

Usage:
  guardrails evaluate --input request.json [--policy guardrails.policy.json] [--json]
  guardrails evaluate --stdin [--policy guardrails.policy.json] [--json]
  guardrails validate --policy guardrails.policy.json
  guardrails version
  guardrails help
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
    console.log(`Policy ${policyPath} is valid.`);
    return;
  }

  if (parsed.command === "evaluate") {
    const policyPath = optionalFlagString(parsed.flags, "policy");
    const policySet = policyPath ? await loadPolicySet(policyPath) : defaultGuardrailPolicySet;
    const inputPath = optionalFlagString(parsed.flags, "input");
    if (!parsed.flags.stdin && !inputPath) throw new Error("--input is required unless --stdin is used.");
    const rawInput = parsed.flags.stdin ? await readJsonFromStdin() : await loadGuardrailInput(inputPath!);
    const input = parseGuardrailInput(rawInput);
    const decision = evaluateGuardrail(input, policySet);
    if (parsed.flags.json) {
      console.log(JSON.stringify(decision, null, 2));
    } else {
      console.log(`${decision.status}: ${decision.reason}`);
      if (decision.matchedPolicies.length > 0) {
        console.log(`matched: ${decision.matchedPolicies.map((policy) => policy.id).join(", ")}`);
      }
      if (decision.redactions.length > 0) console.log(`redactions: ${decision.redactions.length}`);
      if (decision.approvalRequirements.length > 0) console.log(`approvals: ${decision.approvalRequirements.length}`);
    }
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
