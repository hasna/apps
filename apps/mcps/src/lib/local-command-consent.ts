import type { McpServerEntry } from "../types.js";

export type LocalCommandOperation = "register" | "install" | "launch" | "diagnose";
export type LocalCommandRiskSeverity = "warning" | "danger";

export interface LocalCommandInput {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: McpServerEntry["transport"];
  operation?: LocalCommandOperation;
}

export interface LocalCommandConsent {
  approved?: boolean;
  allowRisky?: boolean;
  source?: string;
}

export interface LocalCommandRisk {
  code: string;
  severity: LocalCommandRiskSeverity;
  message: string;
  evidence?: string;
}

export interface LocalCommandReview {
  requiresConsent: boolean;
  operation: LocalCommandOperation;
  command: string;
  args: string[];
  displayCommand: string;
  envKeys: string[];
  risks: LocalCommandRisk[];
  hasDangerousRisk: boolean;
}

export class LocalCommandConsentError extends Error {
  readonly review: LocalCommandReview;

  constructor(message: string, review: LocalCommandReview) {
    super(message);
    this.name = "LocalCommandConsentError";
    this.review = review;
  }
}

const SHELL_COMMANDS = new Set(["bash", "sh", "zsh", "fish", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh"]);
const DESTRUCTIVE_COMMANDS = new Set([
  "rm",
  "dd",
  "mkfs",
  "shutdown",
  "reboot",
  "poweroff",
  "halt",
  "killall",
  "pkill",
]);
const SHELL_EVAL_FLAGS = new Set(["-c", "/c", "-Command", "-command", "-EncodedCommand", "-encodedcommand"]);
const SECRET_FLAG_PATTERN = /(?:^|[-_])(api[-_]?key|token|secret|password|passwd|credential|auth|private[-_]?key)(?:$|[-_])/i;
const SECRET_KEY_PATTERN = /(?:^|[_-])(api[_-]?key|token|secret|password|passwd|credential|auth|private[_-]?key)(?:$|[_-])/i;
const SECRET_VALUE_PATTERN =
  /^(sk_(?:live|test)_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const SHELL_META_PATTERN = /[;&|`<>]|\$\(/;

function commandBase(command: string): string {
  return command.trim().split(/[\\/]/).pop()?.toLowerCase() || command.trim().toLowerCase();
}

function normalizeArgs(args: string[] | undefined): string[] {
  return (args ?? []).map((arg) => String(arg));
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) || SECRET_FLAG_PATTERN.test(key);
}

function isSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERN.test(value.trim());
}

function isSecretAssignment(arg: string): boolean {
  const eqIdx = arg.indexOf("=");
  if (eqIdx <= 0) return false;
  const key = arg.slice(0, eqIdx);
  const value = arg.slice(eqIdx + 1);
  return isSecretKey(key) || isSecretValue(value);
}

function isSecretArg(args: string[], index: number): boolean {
  const arg = args[index] ?? "";
  const previous = args[index - 1] ?? "";
  return isSecretAssignment(arg) || isSecretValue(arg) || SECRET_FLAG_PATTERN.test(previous);
}

function quoteArg(value: string): string {
  return JSON.stringify(value);
}

function displayCommand(command: string, args: string[]): string {
  return [quoteArg(command), ...args.map((arg, index) => quoteArg(isSecretArg(args, index) ? "<redacted>" : arg))].join(" ");
}

function pushRisk(risks: LocalCommandRisk[], risk: LocalCommandRisk): void {
  if (risks.some((existing) => existing.code === risk.code && existing.evidence === risk.evidence)) return;
  risks.push(risk);
}

function inspectRisks(command: string, args: string[], env: Record<string, string>): LocalCommandRisk[] {
  const risks: LocalCommandRisk[] = [];
  const base = commandBase(command);
  const joined = [command, ...args].join(" ");

  if (SHELL_COMMANDS.has(base)) {
    pushRisk(risks, {
      code: "shell_interpreter",
      severity: "warning",
      message: "Command launches a shell interpreter.",
      evidence: base,
    });
    if (args.some((arg) => SHELL_EVAL_FLAGS.has(arg))) {
      pushRisk(risks, {
        code: "shell_eval",
        severity: "danger",
        message: "Shell command evaluates an inline script.",
        evidence: base,
      });
    }
  }

  if (base === "sudo") {
    pushRisk(risks, {
      code: "privilege_escalation",
      severity: "danger",
      message: "Command requests elevated privileges.",
      evidence: base,
    });
  }

  if (DESTRUCTIVE_COMMANDS.has(base) || /\brm\s+-[^\s]*[rf][^\s]*\b/.test(joined) || /--no-preserve-root\b/.test(joined)) {
    pushRisk(risks, {
      code: "destructive_command",
      severity: "danger",
      message: "Command includes a destructive system operation.",
      evidence: base,
    });
  }

  if (/\b(curl|wget)\b[\s\S]*\|[\s\S]*\b(sh|bash|zsh|fish)\b/.test(joined)) {
    pushRisk(risks, {
      code: "download_pipe_shell",
      severity: "danger",
      message: "Command downloads remote content and pipes it to a shell.",
    });
  }

  if ([command, ...args].some((part) => SHELL_META_PATTERN.test(part))) {
    pushRisk(risks, {
      code: "shell_metacharacters",
      severity: "warning",
      message: "Command or arguments contain shell metacharacters.",
    });
  }

  if (args.some((arg, index) => isSecretArg(args, index))) {
    pushRisk(risks, {
      code: "inline_secret",
      severity: "danger",
      message: "Command arguments appear to contain inline secret material.",
    });
  }

  const secretEnvKeys = Object.keys(env).filter(isSecretKey).sort();
  if (secretEnvKeys.length > 0) {
    pushRisk(risks, {
      code: "secret_env",
      severity: "warning",
      message: "Environment contains secret-like keys; values are redacted from consent output.",
      evidence: secretEnvKeys.join(", "),
    });
  }

  return risks;
}

export function inspectLocalCommand(input: LocalCommandInput): LocalCommandReview {
  const args = normalizeArgs(input.args);
  const env = input.env ?? {};
  const transport = input.transport ?? "stdio";
  const risks = inspectRisks(input.command, args, env);
  return {
    requiresConsent: transport === "stdio",
    operation: input.operation ?? "launch",
    command: input.command,
    args,
    displayCommand: displayCommand(input.command, args),
    envKeys: Object.keys(env).sort(),
    risks,
    hasDangerousRisk: risks.some((risk) => risk.severity === "danger"),
  };
}

export function formatLocalCommandReview(review: LocalCommandReview): string {
  const lines = [
    `Command: ${review.displayCommand}`,
    review.envKeys.length > 0 ? `Env keys: ${review.envKeys.join(", ")}` : "Env keys: <none>",
  ];
  if (review.risks.length > 0) {
    lines.push("Risks:");
    for (const risk of review.risks) {
      lines.push(`- ${risk.severity}: ${risk.code} - ${risk.message}${risk.evidence ? ` (${risk.evidence})` : ""}`);
    }
  } else {
    lines.push("Risks: none detected");
  }
  return lines.join("\n");
}

export function assertLocalCommandConsent(
  input: LocalCommandInput,
  consent: LocalCommandConsent = {},
): LocalCommandReview {
  const review = inspectLocalCommand(input);
  if (!review.requiresConsent) return review;

  if (consent.approved !== true) {
    throw new LocalCommandConsentError(
      `local stdio command approval is required before ${review.operation}.\n${formatLocalCommandReview(review)}`,
      review,
    );
  }

  if (review.hasDangerousRisk && consent.allowRisky !== true) {
    throw new LocalCommandConsentError(
      `risky command approval is required before ${review.operation}.\n${formatLocalCommandReview(review)}`,
      review,
    );
  }

  return review;
}
