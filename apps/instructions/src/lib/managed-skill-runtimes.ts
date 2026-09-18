import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** @deprecated Historical report metadata; use the Skills CLI for skill requirements. */
export const INBOX_CONVERSATIONS_MINIMUM_VERSION = "0.5.28";

const INBOX_SKILL_MARKERS = [
  [".claude", "skills", "inbox", "SKILL.md"],
  [".codex", "skills", "inbox", "SKILL.md"],
  [".codewith", "skills", "inbox", "SKILL.md"],
  [".config", "opencode", "skills", "inbox", "SKILL.md"],
  [".cursor", "skills", "inbox", "SKILL.md"],
] as const;

export type ManagedSkillRuntimeAction = "skipped" | "unchanged" | "update" | "failed";

export interface ManagedSkillRuntimeStatus {
  skill: "inbox";
  runtime: "conversations watch";
  minimum_version: typeof INBOX_CONVERSATIONS_MINIMUM_VERSION;
  skill_present: boolean;
  skill_markers: string[];
  skill_contracts_current: number;
  stale_skill_markers: string[];
  expected_skill_sha256: string | null;
  runtime_command: string;
  runtime_present: boolean;
  runtime_version: string | null;
  watch_supports_from: boolean;
  watch_supports_all: boolean;
  watch_supports_full_content: boolean;
  hosted_heartbeat: "unverified" | "passed" | "failed";
  delivery_verified: boolean;
  manual_fallback_ready: boolean;
  healthy: boolean;
  reason: string;
}

export interface ManagedSkillRuntimeInspection {
  runtimes: ManagedSkillRuntimeStatus[];
  skills_present: number;
  healthy: number;
  missing: number;
}

export interface ManagedSkillRuntimeResult extends ManagedSkillRuntimeStatus {
  action: ManagedSkillRuntimeAction;
  dry_run: boolean;
  skill_contracts_changed: number;
}

export interface ManagedSkillRuntimeReconcileReport {
  runtimes: ManagedSkillRuntimeResult[];
  changed: number;
  failed: number;
  dry_run: boolean;
}

export interface ManagedSkillRuntimeOptions {
  homeDir?: string;
  /** @deprecated Ignored. Native skill payload installation has been retired. */
  assetPath?: string;
  /** @deprecated Retained as report metadata only; no subprocess is invoked. */
  conversationsCommand?: string;
  /** @deprecated Ignored. Inspecting skill migration never sends a heartbeat. */
  agent?: string;
  /** @deprecated Ignored. Instructions cannot verify Skills delivery. */
  deliveryVerified?: boolean;
  dryRun?: boolean;
}

/** Return a legacy path needing review without reading payloads or following links. */
function needsMigrationReview(homeDir: string, parts: readonly string[]): boolean {
  let current = resolve(homeDir);
  const absolute = join(current, ...parts);
  for (const segment of parts) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    // An indirection or invalid parent needs explicit migration review. Do not
    // dereference it to inspect another owner's payload or infer clean absence.
    if (stat.isSymbolicLink() || (current !== absolute && !stat.isDirectory())) return true;
  }
  return true;
}

function inspectLegacyInbox(options: ManagedSkillRuntimeOptions): ManagedSkillRuntimeStatus {
  const homeDir = options.homeDir ?? homedir();
  const markers = INBOX_SKILL_MARKERS
    .filter((parts) => needsMigrationReview(homeDir, parts))
    .map((parts) => join(homeDir, ...parts));
  const present = markers.length > 0;
  return {
    skill: "inbox",
    runtime: "conversations watch",
    minimum_version: INBOX_CONVERSATIONS_MINIMUM_VERSION,
    skill_present: present,
    skill_markers: markers,
    skill_contracts_current: 0,
    stale_skill_markers: markers,
    expected_skill_sha256: null,
    runtime_command: options.conversationsCommand ?? "conversations",
    runtime_present: false,
    runtime_version: null,
    watch_supports_from: false,
    watch_supports_all: false,
    watch_supports_full_content: false,
    hosted_heartbeat: "unverified",
    delivery_verified: false,
    manual_fallback_ready: false,
    healthy: !present,
    reason: present
      ? "Native Inbox skill management is retired; use the Skills CLI to review skills migrate native, then sync and load the selected skills"
      : "No legacy native Inbox skill found; skill availability is managed by the Skills CLI",
  };
}

/**
 * @deprecated Read-only legacy inventory. This is not a Skills health check;
 * runtime fields remain unverified and no application command is invoked.
 */
export function inspectManagedSkillRuntimes(
  options: Omit<ManagedSkillRuntimeOptions, "dryRun"> = {},
): ManagedSkillRuntimeInspection {
  const runtime = inspectLegacyInbox(options);
  return {
    runtimes: [runtime],
    skills_present: runtime.skill_present ? 1 : 0,
    healthy: 0,
    missing: runtime.skill_present ? 1 : 0,
  };
}

/**
 * @deprecated Native payload repair is retired, including explicit assetPath
 * compatibility calls. Existing callers receive a failed migration report when
 * legacy paths remain; no payload, provider state or credential is changed.
 */
export async function reconcileManagedSkillRuntimes(
  options: ManagedSkillRuntimeOptions = {},
): Promise<ManagedSkillRuntimeReconcileReport> {
  const runtime = inspectLegacyInbox(options);
  const dryRun = options.dryRun ?? false;
  return {
    runtimes: [{ ...runtime, action: runtime.skill_present ? "failed" : "skipped", dry_run: dryRun, skill_contracts_changed: 0 }],
    changed: 0,
    failed: runtime.skill_present ? 1 : 0,
    dry_run: dryRun,
  };
}
