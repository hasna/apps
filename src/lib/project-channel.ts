import type { Database } from "bun:sqlite";
import { getWorkspace, linkWorkspaceIntegrations, recordWorkspaceEvent } from "../db/workspaces.js";
import type { EventSource, JsonObject, Workspace, WorkspaceIntegrations, WorkspaceKind } from "../types/workspace.js";
import { resolveRegisteredProjectTargetOrThrow } from "./project-resolver.js";

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
 * convention and must not carry a copy of it: the registry slug already
 * carries whatever prefix the convention assigns (`iproj-pr-to-zero`,
 * `platform-alumia`, `iapp-dispatch`, or a flat repo name for a package), so
 * rewriting it here can only ever drift from, contradict, or double-apply the
 * standard. It previously did exactly that: a `project`-kind slug fell through
 * to a hardcoded `internal-` prefix and `iproj-agent-ceo` derived
 * `internal-iproj-agent-ceo`.
 *
 * Projects whose channel does not match their slug say so explicitly by
 * setting `integrations.conversations_channel`; that link always wins over
 * derivation.
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
 * an unvalidated free-form string). `null` means "this kind does not imply a
 * class": the CLI then asserts nothing rather than inventing a label, and
 * `conversations` keeps ownership of the default.
 */
const WORKSPACE_KIND_CHANNEL_CLASSES: Record<WorkspaceKind, ProjectChannelClass | null> = {
  "open-source": "package",
  "internal-app": "product",
  platform: "product",
  "company-website": "product",
  community: "product",
  project: "work-project",
  experiment: "initiative",
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
}

export interface ConversationsRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type ConversationsChannelRunner = (args: string[]) => ConversationsRunResult;

export interface EnsureProjectChannelOptions {
  db?: Database;
  agentId?: string;
  source?: EventSource;
  command?: string;
  /** Conversations identity recorded as channel creator. */
  from?: string;
  /** Persist the resolved channel name on the project record (default true). */
  persist?: boolean;
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
  /** `integrations.conversations_channel` holds the derived channel on the project record. */
  integration_linked: boolean;
  /** The `channel_ensured` audit event was recorded on the project. */
  event_recorded: boolean;
}

export interface ProjectChannelEnsureResult extends ProjectChannelDerivation {
  status: "created" | "exists" | "planned" | "error";
  created: boolean;
  linked: boolean;
  persisted: boolean;
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
  const explicit = project.integrations?.[PROJECT_CHANNEL_CLASS_INTEGRATION_KEY]?.trim().toLowerCase();
  if (explicit) {
    const known = PROJECT_CHANNEL_CLASSES.find((value) => value === explicit);
    if (known) return known;
  }
  return WORKSPACE_KIND_CHANNEL_CLASSES[project.kind] ?? null;
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

export function resolveProjectChannelForProject(project: Workspace): ProjectChannelResolution {
  const derivation = deriveProjectChannel(project);
  return {
    ...derivation,
    project: { id: project.id, slug: project.slug, name: project.name, kind: project.kind },
    linked: Boolean(project.integrations[PROJECT_CHANNEL_INTEGRATION_KEY]?.trim()),
    integration_key: PROJECT_CHANNEL_INTEGRATION_KEY,
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
  const flag = (env["PROJECTS_CHANNEL_ENSURE"] ?? env["OPEN_PROJECTS_CHANNEL_ENSURE"])?.trim().toLowerCase();
  if (flag) {
    if (["1", "true", "on", "yes"].includes(flag)) return true;
    if (["0", "false", "off", "no"].includes(flag)) return false;
  }
  if (env["NODE_ENV"] === "test") return false;
  return true;
}

export const CONVERSATIONS_CLI_TIMEOUT_MS = 15_000;

export function conversationsCliRunner(binary?: string): ConversationsChannelRunner {
  const executable = binary?.trim() || process.env["PROJECTS_CONVERSATIONS_BIN"]?.trim() || "conversations";
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
 * `conversations channel create` args. The resolved channel class is passed
 * through as `--class` (stored by conversations at
 * `metadata.channel_schema.class`) so project channels satisfy the fleet
 * naming/class convention instead of landing class-less; `--topic` gives the
 * channel a human label. A project whose kind implies no class emits no
 * `--class` at all rather than a made-up one, leaving the default to
 * conversations. Older `conversations` builds do not know those flags, so
 * callers fall back to the minimal arg set — see {@link createConversationsChannel}.
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
    persisted: false,
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
    persisted: false,
    warnings: [],
    side_effects: { ...NO_SIDE_EFFECTS, integration_linked: alreadyLinked },
    project,
    message: `Would ensure conversations channel ${derivation.channel}${derivation.channel_class ? ` (${derivation.channel_class})` : ""}.`,
  };
}

/**
 * Ensure the project's conversations channel exists and is linked on the
 * project record. Failures (unreachable conversations CLI, underivable slug)
 * never throw; they are reported through `status: "error"` so project
 * create/start keep working.
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

  let updated = project;
  let persisted = false;
  let eventRecorded = false;
  const inStore = getWorkspace(project.id, options.db);
  if (inStore && options.persist !== false && inStore.integrations[PROJECT_CHANNEL_INTEGRATION_KEY]?.trim() !== derivation.channel) {
    updated = linkWorkspaceIntegrations(project.id, { [PROJECT_CHANNEL_INTEGRATION_KEY]: derivation.channel }, {
      agent_id: options.agentId,
      source: options.source,
      command: options.command,
    }, options.db);
    persisted = true;
  } else if (inStore) {
    updated = inStore;
  }

  if (inStore) {
    // Best-effort audit trail: the channel and the project link are already
    // committed at this point, so a failure to append the event must not turn a
    // completed ensure into a reported failure (see issue #28).
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
          persisted,
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
    persisted,
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
 * Minimal structural view of the projects Store used to persist the channel
 * link. `ProjectStore` (local + api) is assignable to this. Routing channel
 * persistence through the Store is what keeps `projects channel --ensure`
 * correct in api/cloud mode: the integration is written to the project record
 * wherever it actually lives (the cloud) instead of a local sqlite file that
 * does not contain the project (the split-brain the standard forbids).
 */
export interface ProjectChannelStore {
  readonly mode: "local" | "api";
  getProject(idOrSlug: string): Promise<Workspace | null>;
  updateProject(
    id: string,
    patch: { integrations?: WorkspaceIntegrations; agent_id?: string; source?: EventSource; command?: string },
  ): Promise<Workspace>;
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
  /** Persist the resolved channel name on the project record (default true). */
  persist?: boolean;
  dryRun?: boolean;
  runner?: ConversationsChannelRunner;
}

/**
 * Store-routed variant of {@link ensureProjectChannel}. The channel derivation
 * is pure and the conversations channel creation is a machine-local side effect
 * (the local `conversations` client itself routes to the shared cloud), but the
 * project-record persistence (integration link + audit event) goes through the
 * Store so it lands wherever the project actually lives. Never throws for
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
  const alreadyLinked = project.integrations[PROJECT_CHANNEL_INTEGRATION_KEY]?.trim() === derivation.channel;

  if (options.dryRun) {
    return plannedResult(project, derivation, alreadyLinked);
  }

  const runner = options.runner ?? conversationsCliRunner();
  const create = createConversationsChannel(runner, project, derivation, options.from);
  let status: ProjectChannelEnsureResult["status"] = create.status;
  const messages: string[] = create.message ? [create.message] : [];
  const warnings: string[] = [];

  let updated = project;
  let persisted = false;
  let eventRecorded = false;

  // Everything past the channel creation is a store round-trip. In api/cloud
  // mode any of these can fail against a backend that does not implement the
  // route (or is momentarily unreachable) AFTER the channel already exists, so
  // each step is fenced and reported through the result instead of thrown: a
  // partially completed ensure must never surface as a raw transport error with
  // no record of what landed (issue #28).
  let inStore: Workspace | null = null;
  try {
    inStore = await store.getProject(project.id);
  } catch (err) {
    status = "error";
    messages.push(`Could not read the project record back: ${errorText(err)}`);
  }

  if (
    inStore &&
    options.persist !== false &&
    inStore.integrations[PROJECT_CHANNEL_INTEGRATION_KEY]?.trim() !== derivation.channel
  ) {
    try {
      updated = await store.updateProject(project.id, {
        integrations: { ...inStore.integrations, [PROJECT_CHANNEL_INTEGRATION_KEY]: derivation.channel },
        agent_id: options.agentId,
        source: options.source,
        command: options.command,
      });
      persisted = true;
    } catch (err) {
      status = "error";
      messages.push(`Could not link ${derivation.channel} on the project record: ${errorText(err)}`);
    }
  } else if (inStore) {
    updated = inStore;
  }

  if (inStore) {
    // Best-effort audit trail. The channel and the project link are already
    // committed here; a backend that does not expose POST /projects/:id/events
    // must not turn a completed ensure into a total failure.
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
          persisted,
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
    persisted,
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
