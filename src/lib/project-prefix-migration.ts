import { canonicalJson, sha256 } from "./guarded-project-mutation.js";
import {
  conversationsCliRunner,
  type ConversationsChannelRunner,
} from "./project-channel.js";
import { writeWorkspaceMarker, type WorkspaceRuntimeAction } from "./workspace-runtime.js";
import type {
  GuardedProjectMutationReceipt,
  JsonObject,
  Workspace,
  WorkspaceIntegrations,
} from "../types/workspace.js";
import type { CompleteProjectPopulation, ProjectStore } from "../store/project-store.js";

export const PROJECT_PREFIXES = ["internal-iproj-", "iproj-"] as const;
export const PROJECT_PREFIX_MIGRATION_EVENT = "project_prefix_migration_step";

export interface ConversationsChannelIdentity {
  name: string;
  project_id: string | null;
  archived_at: string | null;
  member_count: number;
  message_count: number;
}

export interface CompleteChannelPopulation {
  readonly channels: ConversationsChannelIdentity[];
  readonly total: number;
  readonly pages: number;
  readonly complete: true;
}

export interface ConversationsPrefixPort {
  listChannels(): Promise<CompleteChannelPopulation>;
  renameChannel(input: {
    current_name: string;
    target_name: string;
  }): Promise<ConversationsChannelIdentity>;
}

export interface PrefixMigrationReceipt {
  receipt_id: string;
  operation_id: string;
  step_id: string;
  direction: "forward" | "inverse";
  outcome: "accepted" | "duplicate_of_accepted" | "terminal_nonacceptance";
  target_kind: "project" | "channel";
  target_id: string;
  before: JsonObject;
  after: JsonObject | null;
  reason: string | null;
  created_at: string;
  guarded_receipt_id?: string;
}

export interface PrefixMigrationStep {
  step_id: string;
  target_kind: "project" | "channel";
  target_id: string;
  project_id: string | null;
  current_name: string;
  target_name: string;
  status: "planned" | "accepted" | "rolled_back" | "terminal_nonacceptance";
  receipt: PrefixMigrationReceipt | GuardedProjectMutationReceipt | null;
  marker: WorkspaceRuntimeAction | null;
}

export interface PrefixMigrationInventory {
  projects: CompleteProjectPopulation;
  channels: CompleteChannelPopulation;
  project_candidates: number;
  channel_candidates: number;
  complete: true;
}

export interface PrefixMigrationResult {
  ok: boolean;
  dry_run: boolean;
  operation_id: string;
  inventory: PrefixMigrationInventory;
  steps: PrefixMigrationStep[];
  rollback: {
    attempted: boolean;
    complete: boolean;
    receipts: Array<PrefixMigrationReceipt | GuardedProjectMutationReceipt>;
  };
  refusal: string | null;
}

export interface RunProjectPrefixMigrationOptions {
  store: ProjectStore;
  dry_run?: boolean;
  operation_id?: string;
  response_byte_limit?: number;
  time_budget_ms?: number;
  agent_id?: string;
  command?: string;
  conversations?: ConversationsPrefixPort;
  write_marker?: (project: Workspace) => WorkspaceRuntimeAction;
  /** Test-only failure injection; never exposed as a production CLI option. */
  fail_step_id?: string;
}

export class PrefixMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrefixMigrationError";
  }
}

export function stripProjectPrefix(name: string): { name: string; prefix: string | null } {
  for (const prefix of PROJECT_PREFIXES) {
    if (name.startsWith(prefix)) return { name: name.slice(prefix.length), prefix };
  }
  return { name, prefix: null };
}

function asJson(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

function channelId(channel: ConversationsChannelIdentity): string {
  return `channel:${channel.name}`;
}

function projectId(project: Workspace): string {
  return `project:${project.id}`;
}

function receiptId(input: {
  operation_id: string;
  step_id: string;
  direction: "forward" | "inverse";
  target_id: string;
  before: JsonObject;
  after: JsonObject | null;
}): string {
  return `pmr_${sha256(canonicalJson(input)).slice(0, 32)}`;
}

function migrationReceipt(input: Omit<PrefixMigrationReceipt, "receipt_id" | "created_at">): PrefixMigrationReceipt {
  return {
    ...input,
    receipt_id: receiptId(input),
    created_at: new Date().toISOString(),
  };
}

function channelSnapshot(channel: ConversationsChannelIdentity): JsonObject {
  return {
    name: channel.name,
    project_id: channel.project_id,
    archived_at: channel.archived_at,
    member_count: channel.member_count,
    message_count: channel.message_count,
  };
}

function projectPatch(project: Workspace, targetName: string, linkedChannel?: string): {
  name: string;
  integrations?: WorkspaceIntegrations;
} {
  const patch: { name: string; integrations?: WorkspaceIntegrations } = { name: targetName };
  if (linkedChannel) {
    patch.integrations = {
      ...project.integrations,
      conversations_channel: linkedChannel,
    };
  }
  return patch;
}

function parseChannelList(stdout: string): ConversationsChannelIdentity[] {
  const raw = JSON.parse(stdout) as unknown;
  if (!Array.isArray(raw)) throw new PrefixMigrationError("Conversations channel list did not return a JSON array.");
  return raw.map((value, index) => {
    if (!value || typeof value !== "object") throw new PrefixMigrationError(`Conversations channel row ${index} is not an object.`);
    const row = value as Record<string, unknown>;
    if (typeof row.name !== "string" || !row.name) throw new PrefixMigrationError(`Conversations channel row ${index} has no stable name.`);
    return {
      name: row.name,
      project_id: typeof row.project_id === "string" ? row.project_id : null,
      archived_at: typeof row.archived_at === "string" ? row.archived_at : null,
      member_count: typeof row.member_count === "number" ? row.member_count : 0,
      message_count: typeof row.message_count === "number" ? row.message_count : 0,
    };
  });
}

function parseChannelTotal(stderr: string): number {
  const match = stderr.match(/Showing\s+\d+\s+of\s+(\d+)\./);
  if (!match) throw new PrefixMigrationError("Conversations channel list did not expose its complete producer total.");
  const total = Number(match[1]);
  if (!Number.isInteger(total) || total < 0) throw new PrefixMigrationError(`Invalid Conversations producer total: ${match[1]}`);
  return total;
}

export function createConversationsPrefixPort(
  runner: ConversationsChannelRunner = conversationsCliRunner(),
): ConversationsPrefixPort {
  return {
    async listChannels(): Promise<CompleteChannelPopulation> {
      const channels: ConversationsChannelIdentity[] = [];
      const seen = new Set<string>();
      const limit = 1_000;
      let cursor = 0;
      let total: number | undefined;
      let pages = 0;

      while (pages < 1_000) {
        const result = runner(["channel", "list", "--archived", "--limit", String(limit), "--cursor", String(cursor), "--json"]);
        if (!result.ok) throw new PrefixMigrationError(`Conversations channel inventory failed: ${result.stderr.trim() || "unknown CLI error"}`);
        const page = parseChannelList(result.stdout);
        const pageTotal = parseChannelTotal(result.stderr);
        if (total === undefined) total = pageTotal;
        if (pageTotal !== total) throw new PrefixMigrationError("Conversations channel producer total changed during inventory.");
        if (page.length === 0) {
          if (total !== channels.length) throw new PrefixMigrationError("Conversations channel inventory returned an empty non-terminal page.");
          return { channels, total, pages: pages + 1, complete: true };
        }
        for (const channel of page) {
          if (seen.has(channel.name)) throw new PrefixMigrationError(`Conversations channel inventory returned duplicate "${channel.name}".`);
          const previous = channels[channels.length - 1];
          if (previous && previous.name > channel.name) throw new PrefixMigrationError("Conversations channel inventory order changed during traversal.");
          seen.add(channel.name);
          channels.push(channel);
        }
        pages++;
        if (channels.length === total) return { channels, total, pages, complete: true };
        if (channels.length > total) throw new PrefixMigrationError("Conversations channel inventory exceeded its producer total.");
        cursor += page.length;
      }
      throw new PrefixMigrationError("Conversations channel inventory exceeded its page safety bound.");
    },

    async renameChannel(input): Promise<ConversationsChannelIdentity> {
      const beforePopulation = await this.listChannels();
      const before = beforePopulation.channels.find((channel) => channel.name === input.current_name);
      if (!before) throw new PrefixMigrationError(`Conversations channel source "${input.current_name}" is absent from complete pre-rename inventory.`);
      const result = runner(["channel", "rename", input.current_name, input.target_name, "--json"]);
      if (!result.ok) throw new PrefixMigrationError(`Conversations channel rename failed: ${result.stderr.trim() || "unknown CLI error"}`);
      const rawReturned = JSON.parse(result.stdout) as unknown;
      if (!rawReturned || typeof rawReturned !== "object" || Array.isArray(rawReturned) || (rawReturned as { name?: unknown }).name !== input.target_name) {
        throw new PrefixMigrationError(`Conversations channel rename did not read back target "${input.target_name}".`);
      }
      const population = await this.listChannels();
      const verified = population.channels.find((channel) => channel.name === input.target_name);
      if (!verified) throw new PrefixMigrationError(`Conversations channel rename target "${input.target_name}" is absent from complete readback.`);
      if (verified.member_count !== before.member_count || verified.message_count !== before.message_count) {
        throw new PrefixMigrationError(`Conversations channel rename changed member/message counts for "${input.current_name}".`);
      }
      return verified;
    },
  };
}

function validateCollisions(projects: Workspace[], channels: ConversationsChannelIdentity[]): void {
  const projectTargets = new Map<string, string>();
  for (const project of projects) {
    const target = stripProjectPrefix(project.name);
    if (!target.prefix) continue;
    const previous = projectTargets.get(target.name);
    if (previous && previous !== project.id) throw new PrefixMigrationError(`Project target collision: "${target.name}" is produced by ${previous} and ${project.id}.`);
    projectTargets.set(target.name, project.id);
    const existing = projects.find((candidate) => candidate.name === target.name && candidate.id !== project.id);
    if (existing) throw new PrefixMigrationError(`Project target collision: "${target.name}" already belongs to ${existing.id}.`);
  }

  const channelTargets = new Map<string, string>();
  for (const channel of channels) {
    const target = stripProjectPrefix(channel.name);
    if (!target.prefix) continue;
    const source = channel.name;
    const previous = channelTargets.get(target.name);
    if (previous && previous !== source) throw new PrefixMigrationError(`Channel target collision: "${target.name}" is produced by ${previous} and ${source}.`);
    channelTargets.set(target.name, source);
    const existing = channels.find((candidate) => candidate.name === target.name && candidate.name !== source);
    if (existing) throw new PrefixMigrationError(`Channel target collision: "${target.name}" already exists.`);
  }
}

function validateAmbiguousLinks(projects: Workspace[], channels: ConversationsChannelIdentity[]): void {
  const byProject = new Map<string, ConversationsChannelIdentity[]>();
  for (const channel of channels) {
    if (channel.project_id) {
      if (!projects.some((project) => project.id === channel.project_id)) {
        throw new PrefixMigrationError(`Ambiguous channel effect: "${channel.name}" points to missing project ${channel.project_id}.`);
      }
      const list = byProject.get(channel.project_id) ?? [];
      list.push(channel);
      byProject.set(channel.project_id, list);
    }
  }
  for (const project of projects) {
    const linked = byProject.get(project.id) ?? [];
    const explicit = project.integrations.conversations_channel?.trim();
    if (linked.length > 1 && (stripProjectPrefix(project.name).prefix || linked.some((channel) => stripProjectPrefix(channel.name).prefix))) {
      throw new PrefixMigrationError(`Ambiguous channel effect: project ${project.id} has ${linked.length} project-linked channels.`);
    }
    if (explicit) {
      const matches = channels.filter((channel) => channel.name === explicit);
      if (matches.length !== 1) throw new PrefixMigrationError(`Ambiguous channel effect: project ${project.id} explicitly links missing or duplicate channel "${explicit}".`);
      if (matches[0]!.project_id && matches[0]!.project_id !== project.id) {
        throw new PrefixMigrationError(`Ambiguous channel effect: project ${project.id} links channel "${explicit}" owned by ${matches[0]!.project_id}.`);
      }
    }
    for (const channel of linked) {
      if (explicit && explicit !== channel.name) {
        throw new PrefixMigrationError(`Ambiguous channel effect: project ${project.id} has explicit channel "${explicit}" and project-linked channel "${channel.name}".`);
      }
    }
  }
}

function buildSteps(projects: Workspace[], channels: ConversationsChannelIdentity[]): PrefixMigrationStep[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const candidates: Array<{ target_kind: "project" | "channel"; target_id: string; project_id: string | null; current_name: string; target_name: string; sort: string }> = [];
  for (const channel of channels) {
    const target = stripProjectPrefix(channel.name);
    if (target.prefix) candidates.push({
      target_kind: "channel",
      target_id: channelId(channel),
      project_id: channel.project_id,
      current_name: channel.name,
      target_name: target.name,
      sort: `${channel.project_id ?? "~"}:${channel.name}:0`,
    });
  }
  for (const project of projects) {
    const target = stripProjectPrefix(project.name);
    if (target.prefix) candidates.push({
      target_kind: "project",
      target_id: projectId(project),
      project_id: project.id,
      current_name: project.name,
      target_name: target.name,
      sort: `${project.id}:${project.name}:1`,
    });
  }
  candidates.sort((a, b) => a.sort.localeCompare(b.sort));
  return candidates.map((candidate, index) => ({
    step_id: `step-${String(index + 1).padStart(4, "0")}`,
    target_kind: candidate.target_kind,
    target_id: candidate.target_id,
    project_id: candidate.project_id && projectById.has(candidate.project_id) ? candidate.project_id : null,
    current_name: candidate.current_name,
    target_name: candidate.target_name,
    status: "planned",
    receipt: null,
    marker: null,
  }));
}

function defaultOperationId(inventory: PrefixMigrationInventory): string {
  return `iproj-prefix-migration-${sha256(canonicalJson({
    projects: inventory.projects.projects.map((project) => [project.id, project.updated_at, project.name]),
    channels: inventory.channels.channels.map((channel) => [channel.name, channel.project_id]),
  })).slice(0, 24)}`;
}

function assertBounds(options: RunProjectPrefixMigrationOptions): { response_byte_limit: number; time_budget_ms: number } {
  const response_byte_limit = options.response_byte_limit ?? 1_000_000;
  const time_budget_ms = options.time_budget_ms ?? 30_000;
  if (!Number.isInteger(response_byte_limit) || response_byte_limit <= 0) throw new PrefixMigrationError("response_byte_limit must be a positive integer.");
  if (!Number.isInteger(time_budget_ms) || time_budget_ms <= 0) throw new PrefixMigrationError("time_budget_ms must be a positive integer.");
  return { response_byte_limit, time_budget_ms };
}

async function recordReceipt(store: ProjectStore, projectIdValue: string | null, receipt: PrefixMigrationReceipt | GuardedProjectMutationReceipt, options: RunProjectPrefixMigrationOptions): Promise<void> {
  if (!projectIdValue) return;
  await store.recordEvent(projectIdValue, {
    event_type: PROJECT_PREFIX_MIGRATION_EVENT,
    source: "cli",
    agentId: options.agent_id,
    command: options.command,
    metadata: asJson({ receipt }),
  });
}

export async function runProjectPrefixMigration(options: RunProjectPrefixMigrationOptions): Promise<PrefixMigrationResult> {
  const conversations = options.conversations ?? createConversationsPrefixPort();
  const projects = await options.store.listProjectsComplete();
  const channels = await conversations.listChannels();
  const inventory: PrefixMigrationInventory = {
    projects,
    channels,
    project_candidates: projects.projects.filter((project) => stripProjectPrefix(project.name).prefix).length,
    channel_candidates: channels.channels.filter((channel) => stripProjectPrefix(channel.name).prefix).length,
    complete: true,
  };
  validateCollisions(projects.projects, channels.channels);
  validateAmbiguousLinks(projects.projects, channels.channels);
  const operation_id = options.operation_id ?? defaultOperationId(inventory);
  const steps = buildSteps(projects.projects, channels.channels);
  const result: PrefixMigrationResult = {
    ok: true,
    dry_run: options.dry_run !== false,
    operation_id,
    inventory,
    steps,
    rollback: { attempted: false, complete: true, receipts: [] },
    refusal: null,
  };
  if (result.dry_run || steps.length === 0) return result;

  const bounds = assertBounds(options);
  const projectById = new Map(projects.projects.map((project) => [project.id, project]));
  const channelByName = new Map(channels.channels.map((channel) => [channel.name, channel]));
  const accepted: PrefixMigrationStep[] = [];
  let activeStep: PrefixMigrationStep | null = null;
  const markerWriter = options.write_marker ?? ((project: Workspace) => writeWorkspaceMarker(project, {
    recordEvents: false,
    source: "cli",
    command: options.command ?? "projects migrate-prefixes",
  }));

  try {
    for (const step of steps) {
      activeStep = step;
      if (options.fail_step_id === step.step_id) throw new PrefixMigrationError(`Injected failure at ${step.step_id}.`);
      if (step.target_kind === "channel") {
        const before = channelByName.get(step.current_name);
        if (!before) throw new PrefixMigrationError(`Channel source "${step.current_name}" disappeared after complete inventory.`);
        const after = await conversations.renameChannel({ current_name: step.current_name, target_name: step.target_name });
        const receipt = migrationReceipt({
          operation_id,
          step_id: step.step_id,
          direction: "forward",
          outcome: "accepted",
          target_kind: "channel",
          target_id: step.target_id,
          before: channelSnapshot(before),
          after: channelSnapshot(after),
          reason: null,
        });
        step.receipt = receipt;
        step.status = "accepted";
        accepted.push(step);
        channelByName.delete(step.current_name);
        channelByName.set(step.target_name, after);
        await recordReceipt(options.store, step.project_id, receipt, options);
        continue;
      }

      const project = projectById.get(step.project_id ?? "");
      if (!project) throw new PrefixMigrationError(`Project source "${step.project_id}" disappeared after complete inventory.`);
      const linkedChannel = project.integrations.conversations_channel?.trim();
      const targetChannel = linkedChannel && stripProjectPrefix(linkedChannel).prefix ? stripProjectPrefix(linkedChannel).name : undefined;
      const guarded = await options.store.guardedUpdateProject({
        project_id: project.id,
        operation_id,
        step_id: step.step_id,
        expected_revision: project.updated_at,
        patch: projectPatch(project, step.target_name, targetChannel),
        response_byte_limit: bounds.response_byte_limit,
        time_budget_ms: bounds.time_budget_ms,
        agent_id: options.agent_id,
        source: "cli",
        command: options.command,
      });
      if (!guarded.receipt || (guarded.outcome !== "accepted" && guarded.outcome !== "duplicate_of_accepted")) {
        step.status = "terminal_nonacceptance";
        step.receipt = guarded.receipt;
        throw new PrefixMigrationError(`Guarded project step ${step.step_id} did not return an accepted receipt.`);
      }
      step.receipt = guarded.receipt;
      step.status = "accepted";
      if (guarded.after?.primary_path) step.marker = markerWriter(guarded.after);
      accepted.push(step);
      await recordReceipt(options.store, project.id, guarded.receipt, options);
    }
    return result;
  } catch (error) {
    result.ok = false;
    if (activeStep && activeStep.status === "planned") {
      activeStep.status = "terminal_nonacceptance";
      if (!activeStep.receipt) {
        const before = activeStep.target_kind === "channel"
          ? channelByName.get(activeStep.current_name)
          : projectById.get(activeStep.project_id ?? "");
        activeStep.receipt = migrationReceipt({
          operation_id,
          step_id: activeStep.step_id,
          direction: "forward",
          outcome: "terminal_nonacceptance",
          target_kind: activeStep.target_kind,
          target_id: activeStep.target_id,
          before: asJson(before),
          after: null,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    result.rollback.attempted = true;
    result.rollback.complete = true;
    for (const step of [...accepted].reverse()) {
      try {
        if (step.target_kind === "channel") {
          const after = await conversations.renameChannel({ current_name: step.target_name, target_name: step.current_name });
          const receipt = migrationReceipt({
            operation_id,
            step_id: `${step.step_id}-rollback`,
            direction: "inverse",
            outcome: "accepted",
            target_kind: "channel",
            target_id: step.target_id,
            before: channelSnapshot(after),
            after: asJson(channelByName.get(step.current_name) ?? { name: step.current_name }),
            reason: "forward saga failure",
          });
          result.rollback.receipts.push(receipt);
          step.status = "rolled_back";
          channelByName.delete(step.target_name);
          channelByName.set(step.current_name, after);
          await recordReceipt(options.store, step.project_id, receipt, options);
        } else {
          const receipt = step.receipt as GuardedProjectMutationReceipt | null;
          if (!receipt?.post_revision) throw new PrefixMigrationError(`Cannot rollback ${step.step_id}: accepted receipt has no post revision.`);
          const rollback = await options.store.rollbackGuardedProjectMutation({
            project_id: step.project_id!,
            operation_id,
            step_id: `${step.step_id}-rollback`,
            accepted_receipt_id: receipt.receipt_id,
            expected_current_revision: receipt.post_revision,
            response_byte_limit: bounds.response_byte_limit,
            time_budget_ms: bounds.time_budget_ms,
            agent_id: options.agent_id,
            source: "cli",
            command: options.command,
          });
          if (!rollback.receipt || (rollback.outcome !== "accepted" && rollback.outcome !== "duplicate_of_accepted")) {
            throw new PrefixMigrationError(`Rollback ${step.step_id} did not return an accepted receipt.`);
          }
          result.rollback.receipts.push(rollback.receipt);
          step.status = "rolled_back";
          if (rollback.after?.primary_path) step.marker = markerWriter(rollback.after);
          await recordReceipt(options.store, step.project_id, rollback.receipt, options);
        }
      } catch {
        result.rollback.complete = false;
      }
    }
    result.refusal = error instanceof Error ? error.message : String(error);
    return result;
  }
}
