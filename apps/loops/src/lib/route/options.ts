import type { Command } from "commander";
import { TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID } from "../templates.js";
import { collectValues, listFromRepeatedOpts } from "./parse.js";
import { defaultLoopsProject } from "./todos-cli.js";
import type { TodosDrainOptions } from "./types.js";

/**
 * Single source of truth for the agent-routing flag surface. Every route
 * command (routes create/preview/drain/schedule and the deprecated events
 * handle/drain aliases) composes its options from these specs, and the
 * schedule-loop argv serialization is derived from the same specs so flags can
 * never drift between declaration and replay again.
 */

type RouteOptionKind = "value" | "boolean" | "repeat";

interface RouteOptionSpec {
  /** Commander flags string, e.g. "--provider <provider>". */
  flags: string;
  description: string;
  /** Camel-case commander opts key. */
  key: string;
  kind: RouteOptionKind;
  defaultValue?: string | (() => string);
  /** Only meaningful for todos-task routes (template, role accounts, PR gating). */
  todosTaskOnly?: boolean;
  /** Skip when rebuilding argv (e.g. aliases another flag). */
  skipSerialize?: boolean;
  /** Custom value lookup when rebuilding argv. */
  serializeValue?: (opts: Record<string, unknown>) => unknown;
}

function bareFlag(flags: string): string {
  return flags.split(" ")[0]!;
}

const EVENT_INPUT_OPTION_SPECS: RouteOptionSpec[] = [
  { flags: "--event-file <file>", key: "eventFile", kind: "value", description: "read event envelope JSON from a file instead of stdin/HASNA_EVENT_JSON" },
  { flags: "--event-json <json>", key: "eventJson", kind: "value", description: "read event envelope JSON from this string instead of stdin/HASNA_EVENT_JSON" },
];

const DRAIN_FILTER_OPTION_SPECS: RouteOptionSpec[] = [
  { flags: "--policy <id>", key: "policy", kind: "value", description: "apply a named route policy before draining or scheduling", skipSerialize: true },
  { flags: "--preset <id>", key: "preset", kind: "value", description: "alias for --policy", skipSerialize: true },
  { flags: "--route-policy-evidence <id>", key: "routePolicyEvidence", kind: "value", description: "record an already-expanded route policy id for audit evidence" },
  {
    flags: "--todos-projects-from-registry",
    key: "todosProjectsFromRegistry",
    kind: "boolean",
    description: "scan registered todos projects from `todos projects --json` instead of one --todos-project",
  },
  {
    flags: "--todos-project-include <path>",
    key: "todosProjectInclude",
    kind: "repeat",
    description: "include additional registered project path prefixes when scanning via --todos-projects-from-registry",
    serializeValue: (opts) => listFromRepeatedOpts(opts.todosProjectInclude as string[] | undefined),
  },
  { flags: "--todos-project-id <id>", key: "todosProjectId", kind: "value", description: "filter todos ready output to one todos project id" },
  { flags: "--task-list <id-or-slug>", key: "taskList", kind: "value", description: "filter ready tasks to one task-list id, slug, or name" },
  { flags: "--project-path-prefix <path>", key: "projectPathPrefix", kind: "value", description: "filter ready tasks to a project/repo path prefix" },
  {
    flags: "--tags <tags>",
    key: "tags",
    kind: "value",
    description: "require all comma-separated tags before routing",
    serializeValue: (opts) => opts.tags ?? opts.tag,
  },
  { flags: "--tag <tags>", key: "tag", kind: "value", description: "alias for --tags", skipSerialize: true },
  { flags: "--limit <n>", key: "limit", kind: "value", description: "maximum filtered ready-task candidates to consider", defaultValue: "50" },
  { flags: "--scan-limit <n>", key: "scanLimit", kind: "value", description: "maximum raw todos ready rows to fetch before filters; defaults to 500 when filters are used" },
  { flags: "--max-dispatch <n>", key: "maxDispatch", kind: "value", description: "maximum new workflow loops to create in this drain run", defaultValue: "1" },
  { flags: "--evidence-dir <path>", key: "evidenceDir", kind: "value", description: "write a JSON drain report to this directory" },
  { flags: "--compact", key: "compact", kind: "boolean", description: "print compact JSON to stdout while preserving the full evidence file" },
];

const AGENT_ROUTING_OPTION_SPECS: RouteOptionSpec[] = [
  {
    flags: "--todos-project <path>",
    key: "todosProject",
    kind: "value",
    description: "todos storage project path for generated task commands",
    defaultValue: () => defaultLoopsProject(),
    todosTaskOnly: true,
  },
  {
    flags: "--template <id>",
    key: "template",
    kind: "value",
    description: "todos-task route workflow template: todos-task-worker-verifier or task-lifecycle",
    defaultValue: TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
    todosTaskOnly: true,
  },
  { flags: "--provider <provider>", key: "provider", kind: "value", description: "agent provider; defaults to codewith" },
  {
    flags: "--provider-rule <rule>",
    key: "providerRule",
    kind: "repeat",
    description: "task/event metadata provider routing rule field=value:provider[:profile1,profile2]; may be repeated",
  },
  { flags: "--auth-profile <profile>", key: "authProfile", kind: "value", description: "provider-native auth profile; currently supported for codewith" },
  { flags: "--auth-profile-pool <profiles>", key: "authProfilePool", kind: "value", description: "comma-separated provider-native auth profile pool" },
  { flags: "--triage-auth-profile <profile>", key: "triageAuthProfile", kind: "value", description: "provider-native auth profile for triage step", todosTaskOnly: true },
  { flags: "--planner-auth-profile <profile>", key: "plannerAuthProfile", kind: "value", description: "provider-native auth profile for planner step", todosTaskOnly: true },
  { flags: "--worker-auth-profile <profile>", key: "workerAuthProfile", kind: "value", description: "provider-native auth profile for worker step" },
  { flags: "--verifier-auth-profile <profile>", key: "verifierAuthProfile", kind: "value", description: "provider-native auth profile for verifier step" },
  { flags: "--account <profile>", key: "account", kind: "value", description: "OpenAccounts profile name" },
  { flags: "--account-pool <profiles>", key: "accountPool", kind: "value", description: "comma-separated OpenAccounts profile pool" },
  { flags: "--triage-account <profile>", key: "triageAccount", kind: "value", description: "OpenAccounts profile for triage step", todosTaskOnly: true },
  { flags: "--planner-account <profile>", key: "plannerAccount", kind: "value", description: "OpenAccounts profile for planner step", todosTaskOnly: true },
  { flags: "--worker-account <profile>", key: "workerAccount", kind: "value", description: "OpenAccounts profile for worker step" },
  { flags: "--verifier-account <profile>", key: "verifierAccount", kind: "value", description: "OpenAccounts profile for verifier step" },
  { flags: "--account-tool <tool>", key: "accountTool", kind: "value", description: "OpenAccounts tool id" },
  { flags: "--model <model>", key: "model", kind: "value", description: "provider model" },
  { flags: "--variant <variant>", key: "variant", kind: "value", description: "provider-specific model variant or reasoning effort" },
  { flags: "--agent <agent>", key: "agent", kind: "value", description: "provider-specific agent" },
  {
    flags: "--add-dir <dir>",
    key: "addDir",
    kind: "repeat",
    description: "additional writable directory for provider sandboxes; may be repeated or comma-separated",
    serializeValue: (opts) => listFromRepeatedOpts(opts.addDir as string[] | undefined),
  },
  { flags: "--timeout <duration>", key: "timeout", kind: "value", description: "agent step timeout; use none/unlimited for no timeout" },
  {
    flags: "--verifier-idle-timeout <duration>",
    key: "verifierIdleTimeout",
    kind: "value",
    description: "verifier idle watchdog; use none/off to disable when an external heartbeat exists",
    defaultValue: "15m",
  },
  { flags: "--permission-mode <mode>", key: "permissionMode", kind: "value", description: "provider permission mode: default, plan, auto, or bypass", defaultValue: "bypass" },
  { flags: "--sandbox <mode>", key: "sandbox", kind: "value", description: "provider sandbox" },
  {
    flags: "--manual-break-glass",
    key: "manualBreakGlass",
    kind: "boolean",
    description: "allow danger-full-access in generated worker/verifier workflow metadata; for explicit operator emergency use only",
  },
  { flags: "--project-path <path>", key: "projectPath", kind: "value", description: "fallback project/repo working directory" },
  { flags: "--project-group <name>", key: "projectGroup", kind: "value", description: "optional project group for concurrency limits" },
  { flags: "--max-active <n>", key: "maxActive", kind: "value", description: "skip creating a workflow when this many active routed workflows already exist globally" },
  {
    flags: "--max-active-per-project <n>",
    key: "maxActivePerProject",
    kind: "value",
    description: "skip creating a workflow when this many active routed workflows already exist for the project",
  },
  {
    flags: "--max-active-per-project-group <n>",
    key: "maxActivePerProjectGroup",
    kind: "value",
    description: "skip creating a workflow when this many active routed workflows already exist for the project group",
  },
  {
    flags: "--max-active-scope <key>",
    key: "maxActiveScope",
    kind: "value",
    description: "scope --max-active counting to this route/drain identity (defaults to the LOOPS_LOOP_NAME of the running loop, else the route key) so each drain's --max-active is its own ceiling instead of a store-wide one",
  },
  {
    flags: "--max-per-profile <n>",
    key: "maxPerProfile",
    kind: "value",
    description: "for codewith auth-profile pools, spread dispatch to the least-loaded account and defer when every pool member already has this many running steps (default 2 for pools of 2+; 0 disables the guard)",
  },
  { flags: "--worktree-mode <mode>", key: "worktreeMode", kind: "value", description: "worktree isolation mode: auto, required, off, or main", defaultValue: "auto" },
  { flags: "--worktree-root <path>", key: "worktreeRoot", kind: "value", description: "base directory for OpenLoops-managed git worktrees" },
  { flags: "--worktree-branch-prefix <prefix>", key: "worktreeBranchPrefix", kind: "value", description: "branch prefix for generated worktrees", defaultValue: "openloops" },
  {
    flags: "--pr-handoff",
    key: "prHandoff",
    kind: "boolean",
    description: "for task-lifecycle routes, add a bounded PR handoff step after the worker",
    todosTaskOnly: true,
  },
  {
    flags: "--github-reviewer <login>",
    key: "githubReviewer",
    kind: "value",
    description: "GitHub login expected to review/merge review-required PR routes; must differ from PR author",
    todosTaskOnly: true,
  },
  {
    flags: "--github-reviewer-pool <logins>",
    key: "githubReviewerPool",
    kind: "value",
    description: "comma-separated GitHub logins eligible to review/merge review-required PR routes",
    todosTaskOnly: true,
  },
  { flags: "--name-prefix <prefix>", key: "namePrefix", kind: "value", description: "workflow/loop name prefix" },
  { flags: "--preflight", key: "preflight", kind: "boolean", description: "check generated workflow steps before storing workflow loops" },
];

export interface AgentRoutingOptionConfig {
  /** Include event input options (--event-file/--event-json). */
  eventInput?: boolean;
  /** Include todos-task-only options (template, triage/planner roles, PR gating). */
  todosTask?: boolean;
  /** Default for --provider; when set the option description drops the codewith hint. */
  providerDefault?: string;
  /** Default for --name-prefix. */
  namePrefixDefault?: string;
  /** Override the --preflight help text. */
  preflightDescription?: string;
  /** Include --dry-run with this help text; omit the flag entirely when absent. */
  dryRunDescription?: string;
}

function optionDefault(spec: RouteOptionSpec): string | string[] | undefined {
  if (spec.kind === "repeat") return [];
  const value = spec.defaultValue;
  return typeof value === "function" ? value() : value;
}

function applyOptionSpecs(command: Command, specs: RouteOptionSpec[], config: AgentRoutingOptionConfig): Command {
  for (const spec of specs) {
    if (spec.todosTaskOnly && !config.todosTask) continue;
    let description = spec.description;
    let defaultValue = optionDefault(spec);
    if (spec.key === "provider" && config.providerDefault) {
      description = "agent provider";
      defaultValue = config.providerDefault;
    }
    if (spec.key === "namePrefix" && config.namePrefixDefault) defaultValue = config.namePrefixDefault;
    if (spec.key === "preflight" && config.preflightDescription) description = config.preflightDescription;
    if (spec.kind === "repeat") command.option(spec.flags, description, collectValues, defaultValue as string[]);
    else command.option(spec.flags, description, defaultValue as string | undefined);
  }
  return command;
}

/** Compose the shared agent-routing flag block onto a route command. */
export function addAgentRoutingOptions(command: Command, config: AgentRoutingOptionConfig = {}): Command {
  if (config.eventInput) applyOptionSpecs(command, EVENT_INPUT_OPTION_SPECS, config);
  applyOptionSpecs(command, AGENT_ROUTING_OPTION_SPECS, config);
  if (config.dryRunDescription) command.option("--dry-run", config.dryRunDescription);
  return command;
}

/** Options for `routes create/preview <kind>` and the deprecated `events handle` aliases. */
export function addRouteEventOptions(command: Command, config: AgentRoutingOptionConfig = {}): Command {
  return addAgentRoutingOptions(command, { eventInput: true, todosTask: true, ...config });
}

/** Options for `routes drain/schedule todos-task` and the deprecated `events drain` alias. */
export function addTodosDrainOptions(command: Command, opts: { includeDryRun?: boolean; preflightDescription?: string } = {}): Command {
  applyOptionSpecs(command, DRAIN_FILTER_OPTION_SPECS, {});
  return addAgentRoutingOptions(command, {
    todosTask: true,
    namePrefixDefault: "event:todos-task",
    preflightDescription: opts.preflightDescription,
    dryRunDescription: (opts.includeDryRun ?? true)
      ? "preview selected tasks and generated workflow loops without storing anything"
      : undefined,
  });
}

function serializeOptionSpecs(specs: RouteOptionSpec[], opts: Record<string, unknown>, args: string[]): void {
  for (const spec of specs) {
    if (spec.skipSerialize) continue;
    const flag = bareFlag(spec.flags);
    const value = spec.serializeValue ? spec.serializeValue(opts) : opts[spec.key];
    if (spec.kind === "boolean") {
      if (value === true) args.push(flag);
      continue;
    }
    if (spec.kind === "repeat") {
      for (const entry of (value as unknown[] | undefined) ?? []) args.push(flag, String(entry));
      continue;
    }
    if (value !== undefined && value !== false && value !== "") args.push(flag, String(value));
  }
}

/**
 * Rebuild the argv for a scheduled route drain loop from the same option specs
 * used to declare the flags, so scheduled drains replay exactly the options the
 * operator passed to `routes schedule`.
 */
export function routeDrainArgs(opts: TodosDrainOptions): string[] {
  const args = ["routes", "drain", "todos-task"];
  serializeOptionSpecs(DRAIN_FILTER_OPTION_SPECS, opts as Record<string, unknown>, args);
  serializeOptionSpecs(AGENT_ROUTING_OPTION_SPECS, opts as Record<string, unknown>, args);
  return args;
}
