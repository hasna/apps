/**
 * Integrations with the open-* ecosystem.
 *
 * Each integration is optional and non-fatal — errors are caught and logged
 * but never propagate to the caller.
 */

import type { AlertRow } from "../db/schema.js";
import type { DoctorReport } from "../doctor/index.js";
import type { FleetHealthReport } from "../report.js";

// ── Config types ──────────────────────────────────────────────────────────────

export interface TodosIntegrationConfig {
  enabled: boolean;
  /** todos project ID to create tasks in */
  project_id: string;
  /** Base URL of the todos HTTP API. Default: http://localhost:3000 */
  base_url?: string;
}

export interface ConversationsIntegrationConfig {
  enabled: boolean;
  /** conversations space name/ID to post alerts to */
  space_id: string;
  /** Base URL of the conversations HTTP API. Default: http://localhost:3001 */
  base_url?: string;
}

export interface MementosIntegrationConfig {
  enabled: boolean;
  /** Base URL of the mementos HTTP API. Default: http://localhost:3002 */
  base_url?: string;
  /** Memory bucket (MON-V2-08); default "monitor". */
  bucket?: string;
  /** Memory key template; default "health:{target}". */
  keyTemplate?: string;
  /** required:true makes a confirmed mementos failure affect the run outcome. */
  required?: boolean;
}

export interface EmailsIntegrationConfig {
  enabled: boolean;
  /** Recipient email address for critical alert emails */
  to: string;
  /** Base URL of the emails HTTP API. Default: http://localhost:3003 */
  base_url?: string;
  /** From address (optional) */
  from?: string;
}

export interface IntegrationConfig {
  todos?: TodosIntegrationConfig;
  conversations?: ConversationsIntegrationConfig;
  mementos?: MementosIntegrationConfig;
  emails?: EmailsIntegrationConfig;
}

export interface ReportIntegrationOptions {
  conversations?: boolean;
  emails?: boolean;
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Run all enabled integrations for a given alert.
 * All errors are caught and logged — integrations are always non-fatal.
 */
export async function runIntegrations(
  alert: AlertRow,
  report: DoctorReport,
  config: IntegrationConfig
): Promise<void> {
  const { createTaskForAlert } = await import("./todos.js");
  const { postAlertToSpace } = await import("./conversations.js");
  const { saveHealthMemory } = await import("./mementos.js");
  const { sendAlertEmail } = await import("./emails.js");

  const jobs: Promise<void>[] = [];

  if (config.todos?.enabled) {
    jobs.push(
      createTaskForAlert(alert, config.todos).catch((err) =>
        console.error("[monitor:integrations:todos] error:", err)
      )
    );
  }

  if (config.conversations?.enabled) {
    jobs.push(
      postAlertToSpace(alert, config.conversations).catch((err) =>
        console.error("[monitor:integrations:conversations] error:", err)
      )
    );
  }

  if (config.mementos?.enabled) {
    // No swallow-catch here: saveHealthMemory rejects ONLY on a confirmed
    // failure of a required integration, and that failure must reach the run
    // outcome. Non-blocking outcomes are logged inside the adapter and resolve.
    jobs.push(saveHealthMemory(alert.machine_id, report, config.mementos));
  }

  if (config.emails?.enabled) {
    jobs.push(
      sendAlertEmail(alert, config.emails).catch((err) =>
        console.error("[monitor:integrations:emails] error:", err)
      )
    );
  }

  const results = await Promise.allSettled(jobs);
  // Only a required integration's confirmed failure rejects (all other jobs
  // resolve after their own catch/log). Propagate it so the run outcome is
  // affected, per MON-V2-08: required:true makes a confirmed failure blocking.
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[monitor:integrations] blocking integration failure:", result.reason);
      throw result.reason;
    }
  }
}

export async function runReportIntegrations(
  report: FleetHealthReport,
  config: IntegrationConfig,
  options: ReportIntegrationOptions = {}
): Promise<string[]> {
  const { postReportToSpace } = await import("./conversations.js");
  const { sendReportEmail } = await import("./emails.js");

  const delivered: string[] = [];
  const jobs: Promise<void>[] = [];

  if ((options.conversations ?? true) && config.conversations?.enabled) {
    jobs.push(
      postReportToSpace(report, config.conversations)
        .then(() => {
          delivered.push("conversations");
        })
        .catch((err) => {
          console.error("[monitor:integrations:conversations] report error:", err);
        })
    );
  }

  if ((options.emails ?? true) && config.emails?.enabled) {
    jobs.push(
      sendReportEmail(report, config.emails)
        .then(() => {
          delivered.push("emails");
        })
        .catch((err) => {
          console.error("[monitor:integrations:emails] report error:", err);
        })
    );
  }

  await Promise.allSettled(jobs);
  return delivered.sort();
}
