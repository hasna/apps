/**
 * Env-var naming standard (2026-08-24): harness apps use the HASNA_<APP>_
 * prefix. Todos historically read most of its surface from legacy TODOS_*
 * names with no HASNA_ variant; HASNA_TODOS_* is now canonical and the
 * legacy names remain as a compatibility alias for one deprecation window.
 * Never a silent rename. (HASNA_TODOS_DB_PATH / TODOS_DB_PATH were already
 * aliased at the read site in query-commands.ts and are not duplicated here.)
 *
 * Reads are lazy (function calls) so callers that set process.env at runtime
 * observe the values they set. Canonical wins when both are set; never set
 * both with different values.
 */
const alias = (canonical: string, legacy: string): string | undefined =>
  process.env[canonical] ?? process.env[legacy];

export const env = {
  apiKey: (): string | undefined => alias("HASNA_TODOS_API_KEY", "TODOS_API_KEY"),
  profile: (): string | undefined => alias("HASNA_TODOS_PROFILE", "TODOS_PROFILE"),
  toolGroups: (): string | undefined => alias("HASNA_TODOS_TOOL_GROUPS", "TODOS_TOOL_GROUPS"),
  machineId: (): string | undefined => alias("HASNA_TODOS_MACHINE_ID", "TODOS_MACHINE_ID"),
  machineName: (): string | undefined => alias("HASNA_TODOS_MACHINE_NAME", "TODOS_MACHINE_NAME"),
  rateLimitMax: (): string | undefined => alias("HASNA_TODOS_RATE_LIMIT_MAX", "TODOS_RATE_LIMIT_MAX"),
  trustProxy: (): string | undefined => alias("HASNA_TODOS_TRUST_PROXY", "TODOS_TRUST_PROXY"),
  autoProject: (): string | undefined => alias("HASNA_TODOS_AUTO_PROJECT", "TODOS_AUTO_PROJECT"),
  aiFormat: (): string | undefined => alias("HASNA_TODOS_AI_FORMAT", "TODOS_AI_FORMAT"),
  syncAgents: (): string | undefined => alias("HASNA_TODOS_SYNC_AGENTS", "TODOS_SYNC_AGENTS"),
  taskListId: (): string | undefined => alias("HASNA_TODOS_TASK_LIST_ID", "TODOS_TASK_LIST_ID"),
  claudeTaskList: (): string | undefined =>
    alias("HASNA_TODOS_CLAUDE_TASK_LIST", "TODOS_CLAUDE_TASK_LIST"),
  sandboxProfilesPath: (): string | undefined =>
    alias("HASNA_TODOS_SANDBOX_PROFILES_PATH", "TODOS_SANDBOX_PROFILES_PATH"),
  seatRosterPath: (): string | undefined =>
    alias("HASNA_TODOS_SEAT_ROSTER_PATH", "TODOS_SEAT_ROSTER_PATH"),
  delegateNoticeChannel: (): string | undefined =>
    alias("HASNA_TODOS_DELEGATE_NOTICE_CHANNEL", "TODOS_DELEGATE_NOTICE_CHANNEL"),
  delegateNotifyBin: (): string | undefined =>
    alias("HASNA_TODOS_DELEGATE_NOTIFY_BIN", "TODOS_DELEGATE_NOTIFY_BIN"),
} as const;
