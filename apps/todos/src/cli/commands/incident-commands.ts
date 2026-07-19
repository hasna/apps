import type { Command } from "commander";
import {
  normalizeIncidentCreateInput,
  normalizeIncidentTransitionInput,
  type IncidentState,
} from "../../incidents/contracts.js";
import {
  createIncidentOutboxHttpApi,
  inspectIncidentOutboxPublisher,
  publishIncidentOutboxOnce,
  resolveIncidentProjectorConfig,
  type IncidentOutboxOperatorApi,
  type IncidentOutboxPublisherCallOptions,
} from "../../incidents/outbox-publisher.js";
import {
  cloudCreateIncident,
  cloudGetIncident,
  cloudListIncidentBlockers,
  cloudListIncidentTransitions,
  cloudListIncidents,
  cloudTransitionIncident,
  getTodosCloudClient,
  getTodosRemoteAuthorityConfigStatus,
} from "../cloud-router.js";

const DEFAULT_INCIDENT_PUBLISH_LIMIT = 10;
const DEFAULT_INCIDENT_PUBLISH_LEASE_SECONDS = 60;
const DEFAULT_INCIDENT_PUBLISH_TIMEOUT_MS = 10_000;

function remoteClient() {
  const client = getTodosCloudClient();
  if (!client) {
    throw new Error("INCIDENT_REMOTE_ONLY: canonical incidents require the configured Todos /v1 authority; local SQLite fallback is disabled");
  }
  return client;
}

function strictOutboxApi(): IncidentOutboxOperatorApi {
  const authority = getTodosRemoteAuthorityConfigStatus();
  const apiKey = process.env["HASNA_TODOS_API_KEY"]?.trim();
  if (!authority.selected || !authority.ok || !authority.v1_base_url || !apiKey) {
    throw new Error("INCIDENT_REMOTE_ONLY: incident outbox operations require the configured Todos /v1 authority");
  }
  return createIncidentOutboxHttpApi({ baseUrl: authority.v1_base_url, apiKey });
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

async function boundedOutboxCall<T>(
  timeoutMs: number,
  operation: (options: IncidentOutboxPublisherCallOptions) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("TODOS_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation({ signal: controller.signal }), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
  }
}

function printStructured(program: Command, value: unknown): void {
  console.log(JSON.stringify(value, null, program.opts().json ? 2 : undefined));
}

function printIncidents(program: Command, incidents: IncidentState[]): void {
  if (program.opts().json) {
    console.log(JSON.stringify(incidents, null, 2));
    return;
  }
  if (incidents.length === 0) {
    console.log("No canonical incidents found.");
    return;
  }
  for (const incident of incidents) {
    const blocked = incident.blocked_scopes.length > 0 ? ` blocked=${incident.blocked_scopes.join(",")}` : "";
    console.log(`${incident.severity.padEnd(8)} ${incident.status.padEnd(13)} ${incident.id} ${incident.title}${blocked}`);
  }
}

export function registerIncidentCommands(program: Command): void {
  const incidents = program
    .command("incidents")
    .description("Operate canonical remote incident state (never spawns agents)");

  incidents
    .command("list")
    .description("List canonical incidents")
    .option("--status <status>")
    .option("--severity <severity>")
    .option("--owner <owner>")
    .option("--scope <scope>")
    .option("--active", "Only nonterminal incidents")
    .option("--limit <number>", "Maximum rows", "100")
    .action(async (options: Record<string, unknown>) => {
      const rows = await cloudListIncidents(remoteClient(), {
        status: options.status as string | undefined,
        severity: options.severity as string | undefined,
        owner: options.owner as string | undefined,
        scope: options.scope as string | undefined,
        active: options.active === true ? true : undefined,
        limit: Number(options.limit),
      });
      printIncidents(program, rows);
    });

  incidents
    .command("blockers")
    .description("List active canonical blockers; scope matches blocked scopes only")
    .option("--severity <severity>")
    .option("--owner <owner>")
    .option("--scope <scope>")
    .option("--limit <number>", "Maximum rows", "100")
    .action(async (options: Record<string, unknown>) => {
      const rows = await cloudListIncidentBlockers(remoteClient(), {
        severity: options.severity as string | undefined,
        owner: options.owner as string | undefined,
        scope: options.scope as string | undefined,
        limit: Number(options.limit),
      });
      printIncidents(program, rows);
    });

  incidents
    .command("show <id>")
    .description("Show one canonical incident")
    .action(async (id: string) => {
      const incident = await cloudGetIncident(remoteClient(), id);
      if (!incident) throw new Error(`Incident not found: ${id}`);
      if (program.opts().json) console.log(JSON.stringify(incident, null, 2));
      else printIncidents(program, [incident]);
    });

  incidents
    .command("create")
    .description("Create or atomically supersede a canonical incident")
    .requiredOption("--id <uuid>")
    .requiredOption("--key <idempotency-key>")
    .requiredOption("--title <title>")
    .requiredOption("--severity <severity>")
    .requiredOption("--owner <owner>")
    .requiredOption("--affected-scope <scope...>")
    .requiredOption("--next-action <text>")
    .option("--status <status>", "Initial active status", "open")
    .option("--blocked-scope <scope...>")
    .option("--containment <text>")
    .option("--deadline <rfc3339>")
    .option("--supersedes <uuid>")
    .option("--supersedes-version <number>")
    .action(async (options: Record<string, unknown>) => {
      const input = normalizeIncidentCreateInput({
        id: options.id,
        idempotency_key: options.key,
        title: options.title,
        severity: options.severity,
        status: options.status,
        owner: options.owner,
        affected_scopes: options.affectedScope,
        blocked_scopes: options.blockedScope ?? [],
        containment: options.containment,
        next_action: options.nextAction,
        deadline: options.deadline,
        supersedes_id: options.supersedes,
        supersedes_expected_version: options.supersedesVersion === undefined ? undefined : Number(options.supersedesVersion),
      });
      const result = await cloudCreateIncident(remoteClient(), input);
      if (program.opts().json) console.log(JSON.stringify(result, null, 2));
      else printIncidents(program, [result.incident]);
    });

  incidents
    .command("transition <id>")
    .description("CAS-transition a canonical incident")
    .requiredOption("--expected-version <number>")
    .requiredOption("--key <idempotency-key>")
    .requiredOption("--reason <text>")
    .option("--title <title>")
    .option("--severity <severity>")
    .option("--status <status>")
    .option("--owner <owner>")
    .option("--affected-scope <scope...>")
    .option("--blocked-scope <scope...>")
    .option("--clear-blocked-scopes")
    .option("--containment <text>")
    .option("--next-action <text>")
    .option("--clear-next-action")
    .option("--deadline <rfc3339>")
    .option("--closure-evidence <evidence...>")
    .action(async (id: string, options: Record<string, unknown>) => {
      const input = normalizeIncidentTransitionInput({
        expected_version: Number(options.expectedVersion),
        idempotency_key: options.key,
        reason: options.reason,
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.severity !== undefined ? { severity: options.severity } : {}),
        ...(options.status !== undefined ? { status: options.status } : {}),
        ...(options.owner !== undefined ? { owner: options.owner } : {}),
        ...(options.affectedScope !== undefined ? { affected_scopes: options.affectedScope } : {}),
        ...(options.clearBlockedScopes === true ? { blocked_scopes: [] } :
          options.blockedScope !== undefined ? { blocked_scopes: options.blockedScope } : {}),
        ...(options.containment !== undefined ? { containment: options.containment } : {}),
        ...(options.clearNextAction === true ? { next_action: null } :
          options.nextAction !== undefined ? { next_action: options.nextAction } : {}),
        ...(options.deadline !== undefined ? { deadline: options.deadline } : {}),
        ...(options.closureEvidence !== undefined ? { closure_evidence: options.closureEvidence } : {}),
      });
      const result = await cloudTransitionIncident(remoteClient(), id, input);
      if (program.opts().json) console.log(JSON.stringify(result, null, 2));
      else printIncidents(program, [result.incident]);
    });

  incidents
    .command("transitions <id>")
    .description("List immutable transition history")
    .action(async (id: string) => {
      const rows = await cloudListIncidentTransitions(remoteClient(), id);
      console.log(JSON.stringify(rows, null, 2));
    });

  incidents
    .command("outbox-status")
    .description("Show authority-scoped projection outbox counts (never exposes lease credentials)")
    .action(async () => {
      const result = await inspectIncidentOutboxPublisher({
        outbox: strictOutboxApi(),
        requestTimeoutMs: DEFAULT_INCIDENT_PUBLISH_TIMEOUT_MS,
      });
      printStructured(program, result);
      if (!result.ok) process.exitCode = 1;
    });

  incidents
    .command("outbox-publish")
    .description("Run one bounded incident projection outbox publisher invocation (never a daemon)")
    .option("--limit <number>", "Maximum successfully settled events", String(DEFAULT_INCIDENT_PUBLISH_LIMIT))
    .option("--lease-seconds <number>", "Per-event lease duration", String(DEFAULT_INCIDENT_PUBLISH_LEASE_SECONDS))
    .option("--timeout-ms <number>", "Per-request timeout through response completion", String(DEFAULT_INCIDENT_PUBLISH_TIMEOUT_MS))
    .option("--dry-run", "Inspect outbox status only; does not resolve projector credentials or claim")
    .action(async (options: Record<string, unknown>) => {
      const timeoutMs = boundedInteger(options.timeoutMs, "timeout-ms", 1, 60_000);
      const outbox = strictOutboxApi();
      if (options.dryRun === true) {
        const result = await inspectIncidentOutboxPublisher({ outbox, requestTimeoutMs: timeoutMs });
        printStructured(program, result);
        if (!result.ok) process.exitCode = 1;
        return;
      }
      const projector = resolveIncidentProjectorConfig();
      const result = await publishIncidentOutboxOnce({
        outbox,
        projectorBaseUrl: projector.baseUrl,
        projectorApiKey: projector.apiKey,
        limit: boundedInteger(options.limit, "limit", 1, 1_000),
        leaseSeconds: boundedInteger(options.leaseSeconds, "lease-seconds", 5, 3_600),
        requestTimeoutMs: timeoutMs,
      });
      printStructured(program, result);
      if (!result.ok) process.exitCode = 1;
    });

  incidents
    .command("outbox-dead")
    .description("List dead projection events awaiting explicit operator recovery")
    .option("--limit <number>", "Maximum rows", "100")
    .option("--before-created-at <rfc3339>")
    .option("--before-event-id <event-id>")
    .action(async (options: Record<string, unknown>) => {
      const rows = await boundedOutboxCall(DEFAULT_INCIDENT_PUBLISH_TIMEOUT_MS, (callOptions) => strictOutboxApi().listDead({
        limit: boundedInteger(options.limit, "limit", 1, 100),
        before_created_at: options.beforeCreatedAt as string | undefined,
        before_event_id: options.beforeEventId as string | undefined,
      }, callOptions));
      if (program.opts().json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        console.log("No dead incident projection events found.");
        return;
      }
      for (const row of rows) {
        console.log(`${row.event_id} incident=${row.incident_id} v${row.incident_version} attempts=${row.attempts} consecutive=${row.consecutive_failures} code=${row.failure_code ?? "unknown"}`);
      }
    });

  incidents
    .command("outbox-show <event-id>")
    .description("Show one exact dead projection event")
    .action(async (eventId: string) => {
      const row = await boundedOutboxCall(DEFAULT_INCIDENT_PUBLISH_TIMEOUT_MS, (callOptions) => (
        strictOutboxApi().getDead(eventId, callOptions)
      ));
      if (!row) throw new Error(`Dead incident projection event not found: ${eventId}`);
      console.log(JSON.stringify(row, null, 2));
    });

  incidents
    .command("outbox-requeue <event-id>")
    .description("Audit and requeue one exact dead projection event")
    .requiredOption("--expected-attempts <number>")
    .requiredOption("--key <idempotency-key>")
    .requiredOption("--reason <text>")
    .action(async (eventId: string, options: Record<string, unknown>) => {
      const record = await boundedOutboxCall(DEFAULT_INCIDENT_PUBLISH_TIMEOUT_MS, (callOptions) => strictOutboxApi().requeue(eventId, {
        expected_attempts: boundedInteger(options.expectedAttempts, "expected-attempts", 1, 1_000_000),
        idempotency_key: String(options.key),
        reason: String(options.reason),
      }, callOptions));
      console.log(JSON.stringify(record, null, 2));
    });
}
