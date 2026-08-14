import type { AccountRef, AgentPermissionMode, AgentProvider, AgentSandbox } from "../../types.js";
import { ValidationError } from "../errors.js";
import { automationRecords, firstRouteField, routeFieldList, routeFieldValues, taskEventRecords } from "./fields.js";
import { splitList } from "./parse.js";
import type { TodosTaskRouteOptions } from "./types.js";

export const SUPPORTED_AGENT_PROVIDERS = new Set<AgentProvider>(["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"]);

const PROVIDER_HINT_FIELDS = ["provider_hint", "providerHint", "route_provider", "routeProvider", "agent_provider", "agentProvider"];
const AUTH_PROFILE_HINT_FIELDS = ["auth_profile", "authProfile", "codewith_profile", "codewithProfile", "profile"];
const AUTH_PROFILE_POOL_HINT_FIELDS = ["auth_profile_pool", "authProfilePool", "codewith_profile_pool", "codewithProfilePool", "profile_pool", "profilePool"];
const ACCOUNT_HINT_FIELDS = ["account", "account_profile", "accountProfile", "openaccounts_profile", "openaccountsProfile"];
const ACCOUNT_POOL_HINT_FIELDS = ["account_pool", "accountPool", "openaccounts_pool", "openaccountsPool"];
const ACCOUNT_TOOL_HINT_FIELDS = ["account_tool", "accountTool", "openaccounts_tool", "openaccountsTool"];

export type ProviderRoutingSource = "default" | "option" | "rule" | "metadata";

export interface ProviderRoutingRule {
  raw: string;
  field: string;
  value: string;
  provider: AgentProvider;
  profiles?: string[];
}

export interface ProviderRoutingDecision {
  provider: AgentProvider;
  source: ProviderRoutingSource;
  reason: string;
  rule?: Pick<ProviderRoutingRule, "raw" | "field" | "value" | "provider" | "profiles">;
  authProfile?: string;
  authProfilePool?: string[];
  account?: AccountRef;
  accountPool?: AccountRef[];
}

export function normalizeAgentProvider(value: string | undefined, source: string): AgentProvider {
  const provider = value?.trim().toLowerCase();
  if (provider && SUPPORTED_AGENT_PROVIDERS.has(provider as AgentProvider)) return provider as AgentProvider;
  const expected = [...SUPPORTED_AGENT_PROVIDERS].join(", ");
  throw new ValidationError(`unsupported provider${provider ? ` "${provider}"` : ""} from ${source}; expected one of: ${expected}`);
}

export function parseProviderRoutingRule(raw: string): ProviderRoutingRule {
  const rule = raw.trim();
  const equalsIndex = rule.indexOf("=");
  if (equalsIndex <= 0) throw new ValidationError(`invalid --provider-rule "${raw}", expected field=value:provider[:profile1,profile2]`);
  const selectorIndex = providerRuleSelectorIndex(rule, equalsIndex);
  if (selectorIndex <= 0) throw new ValidationError(`invalid --provider-rule "${raw}", expected field=value:provider[:profile1,profile2]`);
  const selector = rule.slice(0, selectorIndex).trim();
  const route = rule.slice(selectorIndex + 1).trim();
  const field = selector.slice(0, equalsIndex).trim();
  const value = selector.slice(equalsIndex + 1).trim();
  const providerIndex = route.indexOf(":");
  const providerRaw = providerIndex >= 0 ? route.slice(0, providerIndex).trim() : route;
  const profilesRaw = providerIndex >= 0 ? route.slice(providerIndex + 1).trim() : undefined;
  if (!field || !value || !providerRaw) throw new ValidationError(`invalid --provider-rule "${raw}", expected field=value:provider[:profile1,profile2]`);
  return {
    raw,
    field,
    value,
    provider: normalizeAgentProvider(providerRaw, `provider rule ${field}=${value}`),
    profiles: splitList(profilesRaw),
  };
}

function providerRuleSelectorIndex(rule: string, equalsIndex: number): number {
  const firstColon = rule.indexOf(":", equalsIndex + 1);
  if (firstColon < 0) return firstColon;
  let cursor = firstColon;
  while (cursor >= 0) {
    const nextColon = rule.indexOf(":", cursor + 1);
    const providerRaw = (nextColon >= 0 ? rule.slice(cursor + 1, nextColon) : rule.slice(cursor + 1)).trim().toLowerCase();
    if (SUPPORTED_AGENT_PROVIDERS.has(providerRaw as AgentProvider)) return cursor;
    cursor = nextColon;
  }
  return firstColon;
}

function parseProviderRoutingRules(values: string[] | undefined): ProviderRoutingRule[] {
  return (values ?? []).map(parseProviderRoutingRule);
}

function providerRuleMatches(rule: ProviderRoutingRule, records: Record<string, unknown>[]): boolean {
  const expected = rule.value.trim().toLowerCase();
  return routeFieldValues(records, rule.field).some((value) => value.trim().toLowerCase() === expected);
}

function accountRef(profile: string | undefined, tool: string | undefined): AccountRef | undefined {
  return profile ? { profile, tool } : undefined;
}

function accountRefs(profiles: string[] | undefined, tool: string | undefined): AccountRef[] | undefined {
  return profiles?.length ? profiles.map((profile) => ({ profile, tool })) : undefined;
}

export function accountPoolFromOpts(opts: { accountPool?: string; accountTool?: string }): AccountRef[] | undefined {
  return splitList(opts.accountPool)?.map((profile) => ({ profile, tool: opts.accountTool }));
}

export function roleAccountFromOpts(opts: { accountTool?: string }, profile: string | undefined): AccountRef | undefined {
  return profile ? { profile, tool: opts.accountTool } : undefined;
}

export function providerRoutingPublic(decision: ProviderRoutingDecision): Record<string, unknown> {
  return {
    provider: decision.provider,
    source: decision.source,
    reason: decision.reason,
    rule: decision.rule,
    authProfile: decision.authProfile,
    authProfilePool: decision.authProfilePool,
    account: decision.account,
    accountPool: decision.accountPool,
  };
}

export function resolveProviderRouting(
  data: Record<string, unknown>,
  metadata: Record<string, unknown>,
  opts: TodosTaskRouteOptions,
): ProviderRoutingDecision {
  const records = [...taskEventRecords(data, metadata), ...automationRecords(data, metadata)];
  const matchedRule = parseProviderRoutingRules(opts.providerRule).find((rule) => providerRuleMatches(rule, records));
  const metadataProvider = matchedRule || opts.provider ? undefined : firstRouteField(records, PROVIDER_HINT_FIELDS);
  const provider = matchedRule
    ? matchedRule.provider
    : opts.provider
      ? normalizeAgentProvider(opts.provider, "--provider")
      : metadataProvider
        ? normalizeAgentProvider(metadataProvider, "task metadata provider hint")
        : "codewith";
  const source: ProviderRoutingSource = matchedRule
    ? "rule"
    : opts.provider
      ? "option"
      : metadataProvider
        ? "metadata"
        : "default";
  const metadataProfilePool = routeFieldList(records, provider === "codewith" ? AUTH_PROFILE_POOL_HINT_FIELDS : [...ACCOUNT_POOL_HINT_FIELDS, ...AUTH_PROFILE_POOL_HINT_FIELDS]);
  const metadataProfile = firstRouteField(records, provider === "codewith" ? AUTH_PROFILE_HINT_FIELDS : [...ACCOUNT_HINT_FIELDS, ...AUTH_PROFILE_HINT_FIELDS]);
  const profilePool = matchedRule?.profiles ?? metadataProfilePool;
  const profile = metadataProfile;
  const metadataAccountTool = firstRouteField(records, ACCOUNT_TOOL_HINT_FIELDS);
  const accountTool = opts.accountTool ??
    (matchedRule?.profiles ? undefined : metadataAccountTool) ??
    (provider === "codewith" ? undefined : provider);
  const hasResolvedAccountPool = provider !== "codewith" && Boolean((profilePool?.length ?? 0) || profile);
  if (
    opts.accountTool &&
    !opts.account &&
    !opts.accountPool &&
    !opts.triageAccount &&
    !opts.plannerAccount &&
    !opts.workerAccount &&
    !opts.verifierAccount &&
    !hasResolvedAccountPool
  ) {
    throw new ValidationError("--account-tool requires --account, --account-pool, --triage-account, --planner-account, --worker-account, --verifier-account, metadata account hints, or provider-rule profiles");
  }
  if (provider === "codewith") {
    const cliAuthProfilePool = splitList(opts.authProfilePool);
    return {
      provider,
      source,
      reason: matchedRule
        ? `matched provider rule ${matchedRule.field}=${matchedRule.value}`
        : metadataProvider
          ? "selected provider from task metadata"
          : opts.provider
            ? "selected provider from --provider"
            : "selected default provider",
      rule: matchedRule,
      authProfile: opts.authProfile ?? profile,
      authProfilePool: matchedRule?.profiles ?? cliAuthProfilePool ?? (opts.authProfile ? undefined : metadataProfilePool),
      account: accountRef(opts.account, opts.accountTool),
      accountPool: accountPoolFromOpts(opts),
    };
  }
  if (opts.authProfile || opts.authProfilePool) {
    throw new ValidationError(`--auth-profile and --auth-profile-pool are supported only for --provider codewith; use OpenAccounts account profiles for ${provider}`);
  }
  const cliAccountPool = accountPoolFromOpts(opts);
  const account = opts.account
    ? accountRef(opts.account, opts.accountTool ?? provider)
    : accountRef(profile, accountTool);
  return {
    provider,
    source,
    reason: matchedRule
      ? `matched provider rule ${matchedRule.field}=${matchedRule.value}`
      : metadataProvider
        ? "selected provider from task metadata"
        : opts.provider
          ? "selected provider from --provider"
          : "selected default provider",
    rule: matchedRule,
    account,
    accountPool: matchedRule?.profiles ? accountRefs(matchedRule.profiles, accountTool) : cliAccountPool ?? (opts.account ? undefined : accountRefs(metadataProfilePool, accountTool)),
  };
}

export function providerAuthProfileFromOpts(opts: { authProfile?: string }, provider: AgentProvider): string | undefined {
  if (!opts.authProfile) return undefined;
  if (provider !== "codewith") throw new ValidationError("--auth-profile is currently supported only for --provider codewith");
  return opts.authProfile;
}

export function sandboxFromOpts(opts: { sandbox?: string }, provider: AgentProvider): AgentSandbox | undefined {
  if (!opts.sandbox) return undefined;
  const codexLike = ["read-only", "workspace-write", "danger-full-access"];
  const cursorLike = ["enabled", "disabled"];
  if (["codewith", "codex"].includes(provider)) {
    if (!codexLike.includes(opts.sandbox)) {
      throw new ValidationError("--sandbox must be read-only, workspace-write, or danger-full-access for codewith/codex");
    }
    return opts.sandbox as AgentSandbox;
  }
  if (provider === "cursor") {
    if (!cursorLike.includes(opts.sandbox)) {
      throw new ValidationError("--sandbox must be enabled or disabled for cursor");
    }
    return opts.sandbox as AgentSandbox;
  }
  throw new ValidationError("--sandbox is currently supported only for --provider codewith, codex, or cursor");
}

export function permissionModeFromOpts(opts: { permissionMode?: string }, provider: AgentProvider): AgentPermissionMode | undefined {
  if (!opts.permissionMode) return undefined;
  const mode = opts.permissionMode;
  if (!["default", "plan", "auto", "bypass"].includes(mode)) {
    throw new ValidationError("--permission-mode must be default, plan, auto, or bypass");
  }
  if (mode === "plan" && !["claude", "cursor"].includes(provider)) {
    throw new ValidationError("--permission-mode plan is currently supported only for claude or cursor");
  }
  if (mode === "auto" && provider !== "claude") {
    throw new ValidationError("--permission-mode auto is currently supported only for claude");
  }
  return mode as AgentPermissionMode;
}
