import type { Database } from "bun:sqlite";
import { getWorkspace, recordWorkspaceEvent } from "../db/workspaces.js";
import type { EventSource, JsonObject, Workspace, WorkspaceIntegrations, WorkspaceKind } from "../types/workspace.js";
import { resolveRegisteredProjectTargetOrThrow } from "./project-resolver.js";
import { env } from "../lib/env.js";

/**
 * Project -> conversations channel linkage.
 *
 * Every project has exactly one conversations channel (fleet comms protocol).
 * The channel name is stored on the project record as
 * `integrations.conversations_channel`.
 *
 * ## The channel name is the project name
 *
 * When the integration is unset the channel name is the project slug,
 * normalized — nothing more. This CLI does not own the fleet channel naming
 * convention and must not carry a copy of it: rewriting the slug here can only
 * drift from, contradict, or double-apply the standard. It previously did
 * exactly that — a `project`-kind slug fell through to a hardcoded `internal-`
 * prefix, so `iproj-agent-ceo` derived `internal-iproj-agent-ceo`.
 *
 * This is emphatically NOT a claim that every registry slug already conforms.
 * Many do not (a large share of `project`-kind slugs lack `iproj-`, and most
 * `open-source` slugs are not the flat repo name the convention asks for). The
 * claim is narrower and is about authority, not conformance: the slug is the
 * only name this CLI is entitled to use. Where a slug is non-conforming the
 * repair belongs in the project rename/lifecycle path, not in a prefix table
 * here — renaming a project is a decision with a channel migration attached,
 * and silently papering over it at derivation time is what produced the
 * double-prefixed names in the first place.
 *
 * Projects whose channel does not match their slug say so explicitly by
 * setting `integrations.conversations_channel`; that link always wins over
 * derivation.
 *
 * ## Ensure never writes the link
 *
 * {@link ensureProjectChannel} makes the channel exist; it does not pin its
 * name onto the project record. Writing a *derived* name back would convert
 * this package's current opinion into an explicit link, and because an explicit
 * link outranks derivation forever, that write is one-way: it would survive a
 * revert of the very change that produced it, silently repointing a project
 * away from the channel holding its history. The link is established once, at
 * project creation, or deliberately by an operator.
 *
 * ## Channel class
 *
 * The class is a property of the project, not of the channel string, so it is
 * read from the project record — never guessed from the channel name's
 * prefix. See {@link resolveProjectChannelClass}.
 */

/**
 * Channel class vocabulary, per the fleet channel naming + classes convention
 * (`knowledge get hasna-channel-naming-convention`). `fleet` and `personal`
 * are deliberately absent: they are not project channels and this CLI never
 * creates one.
 */
export const PROJECT_CHANNEL_CLASSES = ["package", "product", "work-project", "initiative", "loop-lane"] as const;
export type ProjectChannelClass = (typeof PROJECT_CHANNEL_CLASSES)[number];

export const PROJECT_CHANNEL_INTEGRATION_KEY = "conversations_channel";

/**
 * Optional per-project override for the channel class. Set it on the project
 * record when a project's class does not follow from its kind; it takes
 * precedence over {@link WORKSPACE_KIND_CHANNEL_CLASSES}.
 */
export const PROJECT_CHANNEL_CLASS_INTEGRATION_KEY = "conversations_channel_class";

/**
 * Project kind -> channel class.
 *
 * This is the one mapping that survives, and it is deliberately narrow: it
 * maps this package's own `WorkspaceKind` enum onto the convention's class
 * vocabulary. It contains no channel names and no name prefixes, so it cannot
 * reintroduce the naming defect above — it only labels a channel that has
 * already been named by the project slug.
 *
 * It exists here because nothing publishes the convention machine-readably
 * today (the knowledge item is prose and `conversations` accepts `--class` as
 * an unvalidated free-form string, with no lookup command). Closing that gap is
 * tracked as OPE4-00010; until it is closed, this join has to live somewhere.
 *
 * `null` means "this kind does not imply a class": the CLI then asserts nothing
 * rather than inventing a label, and `conversations` keeps ownership of the
 * default. `experiment` is deliberately `null` even though the convention has
 * an obvious candidate — the `initiative` class additionally requires the topic
 * to carry `owner:<agent> until:<date|gate-id>`, which nothing here can supply,
 * and stamping a class while breaking that class's own rules is worse than
 * leaving it unset.
 */
const WORKSPACE_KIND_CHANNEL_CLASSES: Record<WorkspaceKind, ProjectChannelClass | null> = {
  "open-source": "package",
  "internal-app": "product",
  platform: "product",
  "company-website": "product",
  community: "product",
  project: "work-project",
  experiment: null,
  scaffold: null,
  docs: null,
  "remote-only": null,
  generic: null,
};

export interface ProjectChannelDerivation {
  channel: string;
  /** `null` when the project's kind does not imply a class — see {@link WORKSPACE_KIND_CHANNEL_CLASSES}. */
  channel_class: ProjectChannelClass | null;
  source: "integration" | "derived";
}

export interface ProjectChannelResolution extends ProjectChannelDerivation {
  project: Pick<Workspace, "id" | "slug" | "name" | "kind">;
  linked: boolean;
  integration_key: typeof PROJECT_CHANNEL_INTEGRATION_KEY;
  /**
   * Non-fatal problems, e.g. an unusable `conversations_channel_class`. The
   * read path carries these too: it is the path agents actually use, so a
   * typo'd override must not be silent just because nothing is being created.
   */
  warnings: string[];
}

export interface ConversationsRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type ConversationsChannelRunner = (args: string[]) => ConversationsRunResult;

export type ProjectAgentOnlineNotificationStatus = "sent" | "planned" | "skipped" | "error";

export interface ProjectAgentOnlineNotificationResult {
  status: ProjectAgentOnlineNotificationStatus;
  enabled: boolean;
  sent: boolean;
  channel: string | null;
  from: string;
  agent_tool: string;
  session_name: string;
  message: string;
  reason?: string;
}

export interface NotifyProjectAgentOnlineOptions {
  agentTool: string;
  sessionName: string;
  /** Whether this start created the session that launched the managed agent command. */
  agentStarted: boolean;
  /** Whether this start has a managed coding-agent command at all. */
  hasAgentCommand: boolean;
  enabled?: boolean;
  dryRun?: boolean;
  from?: string;
  runner?: ConversationsChannelRunner;
}

export interface EnsureProjectChannelOptions {
  db?: Database;
  agentId?: string;
  source?: EventSource;
  command?: string;
  /** Conversations identity recorded as channel creator. */
  from?: string;
  dryRun?: boolean;
  runner?: ConversationsChannelRunner;
}

/**
 * What actually landed during an ensure run. Ensure touches three independent
 * systems (conversations channel, project integration link, audit event), so a
 * single boolean cannot describe the outcome: callers need to know which side
 * effects were committed before deciding whether (and how) to retry.
 */
export interface ProjectChannelSideEffects {
  /** The conversations channel was created by this run. */
  channel_created: boolean;
  /** The conversations channel exists now (created by this run or already there). */
  channel_present: boolean;
  /**
   * The project record carries an explicit `integrations.conversations_channel`.
   * Ensure never sets this — it reports what the record already held.
   */
  integration_linked: boolean;
  /** The `channel_ensured` audit event was recorded on the project. */
  event_recorded: boolean;
}

export interface ProjectChannelEnsureResult extends ProjectChannelDerivation {
  status: "created" | "exists" | "planned" | "error";
  created: boolean;
  /** The project record carries an explicit `integrations.conversations_channel`. */
  linked: boolean;
  message?: string;
  /**
   * Non-fatal problems (e.g. the audit event could not be recorded). Present
   * even on success; they never change `status`.
   */
  warnings: string[];
  side_effects: ProjectChannelSideEffects;
  project: Workspace;
}

export function normalizeProjectChannelName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * The project's channel class: an explicit `conversations_channel_class`
 * integration if the project carries one, otherwise whatever its kind implies,
 * otherwise `null` (unknown — assert nothing).
 *
 * Note this never inspects the channel *name*. Classifying by name prefix is
 * what made a correctly named `iproj-*` channel report `package`, since the
 * prefix table it consulted had no `iproj-` row.
 */
export function resolveProjectChannelClass(
  project: Pick<Workspace, "kind"> & { integrations?: WorkspaceIntegrations },
): ProjectChannelClass | null {
  return resolveProjectChannelClassDetailed(project).channel_class;
}

/**
 * As {@link resolveProjectChannelClass}, but also reports an unusable explicit
 * override. This override is the answer to "the class is configurable without a
 * code change", so a typo in it silently reverting to the kind default is
 * exactly the failure that wastes an afternoon — callers surface `warning`.
 */
export function resolveProjectChannelClassDetailed(
  project: Pick<Workspace, "kind"> & { integrations?: WorkspaceIntegrations },
): { channel_class: ProjectChannelClass | null; warning?: string } {
  const fromKind = WORKSPACE_KIND_CHANNEL_CLASSES[project.kind] ?? null;
  const explicit = project.integrations?.[PROJECT_CHANNEL_CLASS_INTEGRATION_KEY]?.trim().toLowerCase();
  if (!explicit) return { channel_class: fromKind };

  const known = PROJECT_CHANNEL_CLASSES.find((value) => value === explicit);
  if (known) return { channel_class: known };
  return {
    channel_class: fromKind,
    warning: `Ignoring unknown ${PROJECT_CHANNEL_CLASS_INTEGRATION_KEY} "${explicit}" on the project record (known: ${PROJECT_CHANNEL_CLASSES.join(", ")}); using ${fromKind ?? "no class"} from kind "${project.kind}" instead.`,
  };
}

export function deriveProjectChannel(
  project: Pick<Workspace, "slug" | "kind"> & { integrations?: WorkspaceIntegrations },
): ProjectChannelDerivation {
  const channel_class = resolveProjectChannelClass(project);

  // An explicitly linked channel always wins: it is how a project states that
  // its channel is not named after its slug.
  const linked = project.integrations?.[PROJECT_CHANNEL_INTEGRATION_KEY]?.trim();
  if (linked) {
    const channel = normalizeProjectChannelName(linked);
    if (!channel) throw new Error(`Linked conversations channel is not a valid channel name: ${linked}`);
    return { channel, channel_class, source: "integration" };
  }

  // The slug already carries the convention — use it as given.
  const channel = normalizeProjectChannelName(project.slug);
  if (!channel) throw new Error(`Project slug does not produce a valid channel name: ${project.slug}`);
  return { channel, channel_class, source: "derived" };
}

/**
 * The channel to show an agent, and whether it is pinned or derived.
 *
 * Bundle and display surfaces must never render a blank channel just because
 * the project has no explicit link: since ensure stopped writing the link, the
 * overwhelming majority of projects resolve their channel by derivation, and a
 * surface that tells an agent where to post would otherwise say `null`. The
 * `source` sibling keeps that honest — a derived name is a current opinion, not
 * a commitment, and callers can say so.
 *
 * Never throws: an underivable slug yields a `null` channel rather than taking
 * down `projects show` or a handoff bundle.
 */
export function projectChannelSummary(
  project: Pick<Workspace, "slug" | "kind"> & { integrations?: WorkspaceIntegrations },
): { channel: string | null; source: ProjectChannelDerivation["source"] | null } {
  try {
    const { channel, source } = deriveProjectChannel(project);
    return { channel, source };
  } catch {
    return { channel: null, source: null };
  }
}

export function resolveProjectChannelForProject(project: Workspace): ProjectChannelResolution {
  const derivation = deriveProjectChannel(project);
  const classWarning = resolveProjectChannelClassDetailed(project).warning;
  return {
    ...derivation,
    project: { id: project.id, slug: project.slug, name: project.name, kind: project.kind },
    linked: Boolean(project.integrations[PROJECT_CHANNEL_INTEGRATION_KEY]?.trim()),
    integration_key: PROJECT_CHANNEL_INTEGRATION_KEY,
    warnings: classWarning ? [classWarning] : [],
  };
}

export function resolveProjectChannel(
  target: string | undefined,
  options: { cwd?: string; db?: Database } = {},
): ProjectChannelResolution {
  const effectiveTarget = target?.trim() || options.cwd?.trim() || ".";
  const resolution = resolveRegisteredProjectTargetOrThrow(effectiveTarget, { db: options.db });
  return resolveProjectChannelForProject(resolution.project);
}

/**
 * Channel ensure runs by default outside of tests; opt out with
 * PROJECTS_CHANNEL_ENSURE=0 (or force on in tests with PROJECTS_CHANNEL_ENSURE=1).
 */
export function shouldEnsureProjectChannel(env: Record<string, string | undefined> = process.env): boolean {
  const flag = (env["HASNA_PROJECTS_CHANNEL_ENSURE"] ?? env["PROJECTS_CHANNEL_ENSURE"] ?? env["OPEN_PROJECTS_CHANNEL_ENSURE"])?.trim().toLowerCase();
  if (flag) {
    if (["1", "true", "on", "yes"].includes(flag)) return true;
    if (["0", "false", "off", "no"].includes(flag)) return false;
  }
  if (env["NODE_ENV"] === "test") return false;
  return true;
}

/**
 * Online announcements are enabled by default. Set
 * PROJECTS_AGENT_ONLINE_NOTIFICATIONS=0 to opt out.
 */
export function shouldNotifyProjectAgentOnline(env: Record<string, string | undefined> = process.env): boolean {
  const flag = (
    env["PROJECTS_AGENT_ONLINE_NOTIFICATIONS"]
    ?? env["OPEN_PROJECTS_AGENT_ONLINE_NOTIFICATIONS"]
  )?.trim().toLowerCase();
  if (flag) {
    if (["1", "true", "on", "yes"].includes(flag)) return true;
    if (["0", "false", "off", "no"].includes(flag)) return false;
  }
  return true;
}

export const CONVERSATIONS_CLI_TIMEOUT_MS = 15_000;

export function conversationsCliRunner(binary?: string): ConversationsChannelRunner {
  const executable = binary?.trim() || env.conversationsBin()?.trim() || "conversations";
  return (args) => {
    try {
      const result = Bun.spawnSync({
        cmd: [executable, ...args],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        timeout: CONVERSATIONS_CLI_TIMEOUT_MS,
      });
      return {
        ok: result.exitCode === 0,
        stdout: Buffer.from(result.stdout).toString("utf-8"),
        stderr: Buffer.from(result.stderr).toString("utf-8"),
      };
    } catch (err) {
      return { ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
    }
  };
}

function projectAgentOnlineMessage(project: Workspace, agentTool: string, sessionName: string): string {
  const label = project.name.trim() || project.slug;
  return `A ${agentTool} agent is online for ${label} (tmux session: ${sessionName}).`;
}

/**
 * Post a project-scoped chat announcement when a start actually brings a
 * coding agent online. This is best-effort: chat failures are returned to the
 * caller and never turn a successful project start into a failure.
 */
export function notifyProjectAgentOnline(
  project: Workspace,
  options: NotifyProjectAgentOnlineOptions,
): ProjectAgentOnlineNotificationResult {
  const enabled = options.enabled ?? shouldNotifyProjectAgentOnline();
  const from = options.from?.trim() || "projects";
  const message = projectAgentOnlineMessage(project, options.agentTool, options.sessionName);
  const base = {
    enabled,
    sent: false,
    channel: null,
    from,
    agent_tool: options.agentTool,
    session_name: options.sessionName,
    message,
  };

  if (!enabled) {
    return { ...base, status: "skipped", reason: "Agent online notifications are disabled." };
  }
  if (!options.hasAgentCommand) {
    return { ...base, status: "skipped", reason: "This start does not launch a managed coding-agent command." };
  }

  let channel: string;
  try {
    channel = deriveProjectChannel(project).channel;
  } catch (err) {
    return { ...base, status: "error", reason: errorText(err) };
  }

  if (options.dryRun) {
    return {
      ...base,
      status: "planned",
      channel,
      reason: `Would notify #${channel} if this start creates the coding-agent session.`,
    };
  }
  if (!options.agentStarted) {
    return { ...base, status: "skipped", channel, reason: "No new coding-agent session was created." };
  }

  const result = (options.runner ?? conversationsCliRunner())([
    "channel",
    "send",
    channel,
    message,
    "--from",
    from,
    "-j",
  ]);
  if (!result.ok) {
    return {
      ...base,
      status: "error",
      channel,
      reason: result.stderr.trim() || result.stdout.trim() || "conversations channel send failed",
    };
  }
  return { ...base, status: "sent", sent: true, channel };
}

function projectChannelDescription(project: Workspace, channelClass: ProjectChannelClass | null): string {
  const label = project.name.trim() || project.slug;
  const classPart = channelClass ? ` — class ${channelClass}` : "";
  return `Project channel for ${label} (${project.slug})${classPart}; auto-created by @hasna/projects.`;
}

function projectChannelTopic(project: Workspace, channelClass: ProjectChannelClass | null): string {
  const label = project.name.trim() || project.slug;
  return `${label} (${project.slug}) — ${channelClass ? `${channelClass} channel` : "project channel"}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `conversations channel create` args.
 *
 * A resolved channel class is passed through as `--class` (stored by
 * conversations at `metadata.channel_schema.class`); `--topic` gives the
 * channel a human label. When the class is `null` no `--class` is sent at all
 * and conversations applies its own default — that is a deliberate narrowing of
 * the behaviour added in #28, which always sent a class: the class it sent for
 * kinds with no convention entry was `initiative`, inferred from the same
 * `internal-` prefix rule this change deletes. An unfounded label is worse than
 * none. Note this means most projects (`generic` is by far the largest kind in
 * the registry) now create channels with no class.
 *
 * Older `conversations` builds do not know these flags, so callers fall back to
 * the minimal arg set — see {@link createConversationsChannel}.
 */
function buildChannelCreateArgs(
  project: Workspace,
  derivation: ProjectChannelDerivation,
  options: { from?: string; withMetadata?: boolean } = {},
): string[] {
  const args = [
    "channel",
    "create",
    derivation.channel,
    "--description",
    projectChannelDescription(project, derivation.channel_class),
  ];
  if (options.withMetadata !== false) {
    if (derivation.channel_class) args.push("--class", derivation.channel_class);
    args.push("--topic", projectChannelTopic(project, derivation.channel_class));
  }
  args.push("-j");
  if (options.from?.trim()) args.push("--from", options.from.trim());
  return args;
}

/** A CLI rejection caused by an option the installed conversations build lacks. */
function isUnsupportedOptionFailure(result: ConversationsRunResult): boolean {
  const output = `${result.stderr} ${result.stdout}`.toLowerCase();
  return /unknown option|unrecognized option|unknown argument|invalid option|unknown flag/.test(output);
}

/**
 * Create the channel, retrying without the class/topic metadata flags when the
 * installed conversations CLI is too old to understand them. Never throws.
 */
function createConversationsChannel(
  runner: ConversationsChannelRunner,
  project: Workspace,
  derivation: ProjectChannelDerivation,
  from: string | undefined,
): { status: Exclude<ProjectChannelEnsureResult["status"], "planned">; message?: string } {
  let result = runner(buildChannelCreateArgs(project, derivation, { from }));
  if (!result.ok && isUnsupportedOptionFailure(result)) {
    result = runner(buildChannelCreateArgs(project, derivation, { from, withMetadata: false }));
  }
  if (result.ok) return { status: "created" };
  const output = `${result.stderr} ${result.stdout}`.toLowerCase();
  // `channel create` on an existing channel fails with an "already exists"
  // message, which doubles as the existence probe.
  if (output.includes("exist")) return { status: "exists" };
  return {
    status: "error",
    message: result.stderr.trim() || result.stdout.trim() || "conversations channel create failed",
  };
}

const NO_SIDE_EFFECTS: ProjectChannelSideEffects = {
  channel_created: false,
  channel_present: false,
  integration_linked: false,
  event_recorded: false,
};

function derivationErrorResult(project: Workspace, message: string): ProjectChannelEnsureResult {
  return {
    channel: "",
    // Derivation failed, so no class was established either.
    channel_class: null,
    source: "derived",
    status: "error",
    created: false,
    linked: false,
    message,
    warnings: [],
    side_effects: { ...NO_SIDE_EFFECTS },
    project,
  };
}

function plannedResult(
  project: Workspace,
  derivation: ProjectChannelDerivation,
  alreadyLinked: boolean,
): ProjectChannelEnsureResult {
  return {
    ...derivation,
    status: "planned",
    created: false,
    linked: alreadyLinked,
    warnings: [],
    side_effects: { ...NO_SIDE_EFFECTS, integration_linked: alreadyLinked },
    project,
    message: `Would ensure conversations channel ${derivation.channel}${derivation.channel_class ? ` (${derivation.channel_class})` : ""}.`,
  };
}

/**
 * Ensure the project's conversations channel exists. It does NOT link the
 * channel on the project record — see "Ensure never writes the link" above.
 * Failures (unreachable conversations CLI, underivable slug) never throw; they
 * are reported through `status: "error"` so project create/start keep working.
 */
export function ensureProjectChannel(
  project: Workspace,
  options: EnsureProjectChannelOptions = {},
): ProjectChannelEnsureResult {
  let derivation: ProjectChannelDerivation;
  try {
    derivation = deriveProjectChannel(project);
  } catch (err) {
    return derivationErrorResult(project, errorText(err));
  }
  const alreadyLinked = project.integrations[PROJECT_CHANNEL_INTEGRATION_KEY]?.trim() === derivation.channel;

  if (options.dryRun) {
    return plannedResult(project, derivation, alreadyLinked);
  }

  const runner = options.runner ?? conversationsCliRunner();
  // Create-first: one CLI call per ensure instead of listing every channel.
  const create = createConversationsChannel(runner, project, derivation, options.from);
  const status: ProjectChannelEnsureResult["status"] = create.status;
  const message = create.message;
  const warnings: string[] = [];
  const classWarning = resolveProjectChannelClassDetailed(project).warning;
  if (classWarning) warnings.push(classWarning);

  let eventRecorded = false;
  const inStore = getWorkspace(project.id, options.db);
  const updated = inStore ?? project;

  if (inStore) {
    // Best-effort audit trail: the channel already exists at this point, so a
    // failure to append the event must not turn a completed ensure into a
    // reported failure (see issue #28).
    try {
      recordWorkspaceEvent({
        workspace_id: project.id,
        agent_id: options.agentId,
        event_type: "channel_ensured",
        source: options.source ?? "cli",
        command: options.command,
        after: {
          channel: derivation.channel,
          channel_class: derivation.channel_class,
          status,
          created: status === "created",
          message,
        },
      }, options.db);
      eventRecorded = true;
    } catch (err) {
      warnings.push(`Channel ensure audit event was not recorded: ${errorText(err)}`);
    }
  }

  const linked = Boolean(updated.integrations[PROJECT_CHANNEL_INTEGRATION_KEY]?.trim());
  return {
    ...derivation,
    status,
    created: status === "created",
    linked,
    message,
    warnings,
    side_effects: {
      channel_created: status === "created",
      channel_present: status === "created" || status === "exists",
      integration_linked: linked,
      event_recorded: eventRecorded,
    },
    project: updated,
  };
}

/**
 * Minimal structural view of the projects Store used by the store-routed
 * ensure. `ProjectStore` (local + HTTP) is assignable to this.
 *
 * Ensure no longer writes the channel link, so this carries no `updateProject`:
 * the only thing routed through the Store is the audit event, which must land
 * wherever the project actually lives (the hosted backend) rather than in a
 * local sqlite file that does not contain the project.
 */
export interface ProjectChannelStore {
  readonly transport: "local" | "http";
  recordEvent(
    idOrSlug: string,
    input: { event_type: string; source: EventSource; agentId?: string; command?: string; after?: JsonObject | null },
  ): Promise<unknown>;
}

export interface StoreEnsureChannelOptions {
  agentId?: string;
  source?: EventSource;
  command?: string;
  /** Conversations identity recorded as channel creator. */
  from?: string;
  dryRun?: boolean;
  runner?: ConversationsChannelRunner;
}

/**
 * Store-routed variant of {@link ensureProjectChannel}. The channel derivation
 * is pure and the conversations channel creation is a machine-local side effect
 * (the local `conversations` client itself routes to the shared hosted service); the
 * audit event goes through the Store so it lands wherever the project actually
 * lives. Nothing here writes the project record. Never throws for
 * conversations/derivation failures; reports them via `status: "error"`.
 */
export async function ensureProjectChannelViaStore(
  store: ProjectChannelStore,
  project: Workspace,
  options: StoreEnsureChannelOptions = {},
): Promise<ProjectChannelEnsureResult> {
  let derivation: ProjectChannelDerivation;
  try {
    derivation = deriveProjectChannel(project);
  } catch (err) {
    return derivationErrorResult(project, errorText(err));
  }
  // Same definition the real path uses at the end of this function: "the record
  // carries a pin", not "the pin equals what we just derived". Comparing a raw
  // pin against a normalized channel would make --dry-run disagree with the
  // real run for any pin needing normalization.
  const alreadyLinked = Boolean(project.integrations[PROJECT_CHANNEL_INTEGRATION_KEY]?.trim());

  if (options.dryRun) {
    return plannedResult(project, derivation, alreadyLinked);
  }

  const runner = options.runner ?? conversationsCliRunner();
  const create = createConversationsChannel(runner, project, derivation, options.from);
  let status: ProjectChannelEnsureResult["status"] = create.status;
  const messages: string[] = create.message ? [create.message] : [];
  const warnings: string[] = [];
  const classWarning = resolveProjectChannelClassDetailed(project).warning;
  if (classWarning) warnings.push(classWarning);

  let eventRecorded = false;

  // No store read-back: with the link write gone there is nothing to re-read.
  // `linked` is answered by the record we were handed, and re-fetching it would
  // only add a network round-trip in the hosted backend whose transient failure
  // would report a fully created channel as an error.
  const updated = project;

  {
    // Best-effort audit trail. The channel already exists here; a backend that
    // does not expose POST /projects/:id/events must not turn a completed
    // ensure into a total failure (issue #28).
    try {
      await store.recordEvent(project.id, {
        event_type: "channel_ensured",
        source: options.source ?? "cli",
        agentId: options.agentId,
        command: options.command,
        after: {
          channel: derivation.channel,
          channel_class: derivation.channel_class,
          status,
          created: status === "created",
          message: messages[0] ?? null,
        } as JsonObject,
      });
      eventRecorded = true;
    } catch (err) {
      warnings.push(`Channel ensure audit event was not recorded: ${errorText(err)}`);
    }
  }

  const linked = Boolean(updated.integrations[PROJECT_CHANNEL_INTEGRATION_KEY]?.trim());
  return {
    ...derivation,
    status,
    created: create.status === "created",
    linked,
    message: messages.length ? messages.join("; ") : undefined,
    warnings,
    side_effects: {
      channel_created: create.status === "created",
      channel_present: create.status === "created" || create.status === "exists",
      integration_linked: linked,
      event_recorded: eventRecorded,
    },
    project: updated,
  };
}
