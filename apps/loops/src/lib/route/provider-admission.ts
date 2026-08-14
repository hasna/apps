import { spawnSync } from "node:child_process";
import type { AgentProvider } from "../../types.js";
import { ValidationError } from "../errors.js";
import { redact } from "../format.js";
import { positiveInteger } from "./parse.js";
import type { TodosTaskRouteOptions } from "./types.js";

/** Provider-native admission checks for routes that create background agents. */

export interface CodewithAdmissionDiagnostics {
  activeRunCount?: number;
  maxActiveRunsPerUser?: number;
  availableActiveRunSlots?: number;
}

export interface ProviderAdmissionPlan {
  provider: AgentProvider;
  authProfile?: string;
  authProfiles?: Array<string | undefined>;
  activeCap?: number;
  admissionCheck: boolean;
}

export interface ProviderAdmissionDecision {
  allowed: boolean;
  provider: AgentProvider;
  checked: boolean;
  check: "codewith-agent-diagnostics" | "unsupported-provider" | "dry-run";
  reason?: string;
  authProfile?: string;
  authProfiles?: string[];
  activeCap?: number;
  fatal?: boolean;
  diagnostics?: CodewithAdmissionDiagnostics | Record<string, unknown>;
}

function publicError(value: string | undefined): string | undefined {
  return redact(value?.trim() || undefined);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function findNumber(value: unknown, keys: string[], depth = 0): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 4) return undefined;
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    const direct = finiteNumber(object[key]);
    if (direct !== undefined) return direct;
  }
  for (const nested of Object.values(object)) {
    const found = findNumber(nested, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function parseCodewithAdmissionDiagnostics(stdout: string): CodewithAdmissionDiagnostics {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout || "{}");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`codewith diagnostics did not return valid JSON: ${message}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("codewith diagnostics JSON must be an object");
  }
  return {
    activeRunCount: findNumber(payload, ["activeRunCount", "active_run_count", "activeRuns", "active_runs"]),
    maxActiveRunsPerUser: findNumber(payload, ["maxActiveRunsPerUser", "max_active_runs_per_user", "maxActiveRuns", "max_active_runs"]),
    availableActiveRunSlots: findNumber(payload, ["availableActiveRunSlots", "available_active_run_slots", "availableRunSlots", "available_run_slots"]),
  };
}

export function providerActiveCapFromOpts(opts: Pick<TodosTaskRouteOptions, "providerActiveCap" | "codewithActiveCap">): number | undefined {
  const providerActiveCap = positiveInteger(opts.providerActiveCap, "--provider-active-cap");
  const codewithActiveCap = positiveInteger(opts.codewithActiveCap, "--codewith-active-cap");
  if (providerActiveCap !== undefined && codewithActiveCap !== undefined && providerActiveCap !== codewithActiveCap) {
    throw new ValidationError("--provider-active-cap and --codewith-active-cap must match when both are set");
  }
  return providerActiveCap ?? codewithActiveCap;
}

export function providerAdmissionPlanFromOpts(
  opts: TodosTaskRouteOptions,
  args: { provider: AgentProvider; authProfile?: string; authProfiles?: Array<string | undefined> },
): ProviderAdmissionPlan | undefined {
  const activeCap = providerActiveCapFromOpts(opts);
  const admissionCheck = Boolean(opts.providerAdmissionCheck);
  if (!admissionCheck && activeCap === undefined) return undefined;
  return {
    provider: args.provider,
    authProfile: args.authProfile,
    authProfiles: normalizedAuthProfiles(args.authProfiles ?? []),
    activeCap,
    admissionCheck,
  };
}

export function providerAdmissionPlanWithAuthProfiles(
  plan: ProviderAdmissionPlan | undefined,
  authProfiles: Array<string | undefined>,
): ProviderAdmissionPlan | undefined {
  if (!plan) return undefined;
  const unique = normalizedAuthProfiles(authProfiles);
  if (unique.length === 0) return plan;
  return {
    ...plan,
    authProfile: unique.length === 1 ? unique[0] : undefined,
    authProfiles: unique,
  };
}

export function providerAdmissionDryRunPreview(plan: ProviderAdmissionPlan | undefined): ProviderAdmissionDecision | undefined {
  if (!plan) return undefined;
  return {
    allowed: true,
    provider: plan.provider,
    checked: false,
    check: "dry-run",
    authProfile: plan.authProfile,
    authProfiles: publicAuthProfiles(plan.authProfiles),
    activeCap: plan.activeCap,
    reason: "not evaluated in dry-run because provider diagnostics would shell out to the provider CLI",
  };
}

function commandFailure(status: number | null, stderr: string, error?: Error): ProviderAdmissionDecision["diagnostics"] {
  return {
    status,
    stderr: publicError(stderr),
    error: error ? publicError(error.message) : undefined,
  };
}

function normalizedAuthProfiles(authProfiles: Array<string | undefined>): Array<string | undefined> {
  const values: Array<string | undefined> = [];
  const seen = new Set<string>();
  for (const entry of authProfiles) {
    const profile = entry?.trim() || undefined;
    const key = profile ?? "<default>";
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(profile);
  }
  return values;
}

function publicAuthProfiles(authProfiles: Array<string | undefined> | undefined): string[] | undefined {
  const values = normalizedAuthProfiles(authProfiles ?? []).filter((entry): entry is string => Boolean(entry));
  return values.length ? values : undefined;
}

export function checkProviderAdmission(plan: ProviderAdmissionPlan | undefined): ProviderAdmissionDecision | undefined {
  if (!plan) return undefined;
  if (plan.provider !== "codewith") {
    return {
      allowed: false,
      provider: plan.provider,
      checked: false,
      check: "unsupported-provider",
      activeCap: plan.activeCap,
      fatal: true,
      reason: `provider admission check is not supported for provider ${plan.provider}`,
    };
  }
  const profiles = plan.authProfiles?.length ? normalizedAuthProfiles(plan.authProfiles) : [plan.authProfile];
  const checks = profiles.map((profile) => checkCodewithAdmissionProfile(plan, profile));
  const fatalDenied = checks.find((entry) => !entry.allowed && entry.fatal);
  const denied = fatalDenied ?? checks.find((entry) => !entry.allowed);
  if (checks.length === 1) return checks[0]!;
  const authProfiles = checks.map((entry) => entry.authProfile).filter((entry): entry is string => Boolean(entry));
  return {
    allowed: !denied,
    provider: plan.provider,
    checked: true,
    check: "codewith-agent-diagnostics",
    authProfiles,
    activeCap: plan.activeCap,
    fatal: checks.some((entry) => entry.fatal),
    reason: denied
      ? `codewith provider admission denied for ${denied.authProfile ?? "default profile"}: ${denied.reason}`
      : `codewith admission available for ${checks.length} auth profiles`,
    diagnostics: { profiles: checks.map(({ diagnostics, ...entry }) => ({ ...entry, diagnostics })) },
  };
}

function checkCodewithAdmissionProfile(plan: ProviderAdmissionPlan, authProfile: string | undefined): ProviderAdmissionDecision {
  const args = [...(authProfile ? ["--auth-profile", authProfile] : []), "agent", "diagnostics", "--json"];
  const result = spawnSync("codewith", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  });
  if (result.error || (result.status ?? 1) !== 0) {
    return {
      allowed: false,
      provider: plan.provider,
      checked: true,
      check: "codewith-agent-diagnostics",
      authProfile,
      activeCap: plan.activeCap,
      fatal: true,
      reason: `codewith diagnostics failed${result.status === null ? "" : ` with exit ${result.status}`}`,
      diagnostics: commandFailure(result.status, result.stderr ?? "", result.error),
    };
  }
  let diagnostics: CodewithAdmissionDiagnostics;
  try {
    diagnostics = parseCodewithAdmissionDiagnostics(result.stdout ?? "");
  } catch (error) {
    return {
      allowed: false,
      provider: plan.provider,
      checked: true,
      check: "codewith-agent-diagnostics",
      authProfile,
      activeCap: plan.activeCap,
      fatal: true,
      reason: error instanceof Error ? error.message : String(error),
      diagnostics: {
        status: result.status,
        stdout: publicError(result.stdout ?? ""),
        stderr: publicError(result.stderr ?? ""),
      },
    };
  }
  const activeRunCount = diagnostics.activeRunCount;
  const availableSlots = diagnostics.availableActiveRunSlots ??
    (activeRunCount !== undefined && diagnostics.maxActiveRunsPerUser !== undefined
      ? diagnostics.maxActiveRunsPerUser - activeRunCount
      : undefined);
  if (plan.activeCap !== undefined) {
    if (activeRunCount === undefined) {
      return {
        allowed: false,
        provider: plan.provider,
        checked: true,
        check: "codewith-agent-diagnostics",
        authProfile,
        activeCap: plan.activeCap,
        fatal: true,
        diagnostics,
        reason: "codewith diagnostics did not include activeRunCount for --provider-active-cap",
      };
    }
    if (activeRunCount >= plan.activeCap) {
      return {
        allowed: false,
        provider: plan.provider,
        checked: true,
        check: "codewith-agent-diagnostics",
        authProfile,
        activeCap: plan.activeCap,
        diagnostics,
        reason: `codewith active-run cap reached (${activeRunCount}/${plan.activeCap})`,
      };
    }
  }
  if (availableSlots !== undefined && availableSlots <= 0) {
    return {
      allowed: false,
      provider: plan.provider,
      checked: true,
      check: "codewith-agent-diagnostics",
      authProfile,
      activeCap: plan.activeCap,
      diagnostics,
      reason: `codewith provider admission unavailable (availableActiveRunSlots=${availableSlots})`,
    };
  }
  if (plan.admissionCheck && plan.activeCap === undefined && availableSlots === undefined && activeRunCount === undefined) {
    return {
      allowed: false,
      provider: plan.provider,
      checked: true,
      check: "codewith-agent-diagnostics",
      authProfile,
      fatal: true,
      diagnostics,
      reason: "codewith diagnostics did not include activeRunCount or availableActiveRunSlots",
    };
  }
  return {
    allowed: true,
    provider: plan.provider,
    checked: true,
    check: "codewith-agent-diagnostics",
    authProfile,
    activeCap: plan.activeCap,
    diagnostics,
    reason: activeRunCount !== undefined
      ? `codewith admission available (activeRunCount=${activeRunCount}${plan.activeCap !== undefined ? `/${plan.activeCap}` : ""})`
      : "codewith admission available",
  };
}
