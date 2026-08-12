import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import postgres from "postgres";
import type {
  ActionDeadLetter,
  ActionError,
  ActionResult,
  JsonObject,
  JsonValue,
} from "@hasna/actions";
import type {
  AutomationActionStep,
  AutomationRecord,
  AutomationReplayRequest,
  AutomationRun,
  AutomationsStatus,
  AutomationSpec,
  AutomationTrigger,
  EventEnvelopeLike,
  MaterializedEventRun,
  MaterializedWebhookRequest,
  QueueClaimOptions,
  QueuedAction,
  WebhookRequestInput,
  WebhookRoute,
  WebhookRouteStatus,
  WebhookSignatureConfig,
} from "../../types.js";
import { AUTOMATION_SCHEMA_VERSION, WEBHOOK_ROUTE_STATUSES } from "../../types.js";
import type { ActionQueueApprovalDecision, ActionQueueApprovalGate } from "../../lib/action-queue.js";
import { isTerminalActionQueueStatus } from "../../lib/action-queue.js";
import {
  normalizeWebhookRequestToEvent,
  validateAutomationSpec,
  type CreateWebhookRouteInput,
  type EnqueueActionInput,
} from "../../lib/store.js";
import type {
  CreateReplayRequestInput,
  CreateRunInput,
  DaemonHeartbeatInput,
  FencedActionCompletionOptions,
  FencedActionFailureOptions,
  LeasedQueuedAction,
  ListPageOptions,
  RenewActionLeaseOptions,
  ServerAutomationsStore,
} from "../store.js";
import { migratePostgreSql, type PostgreSqlExecutor } from "./migrations.js";

type Row = Record<string, unknown>;
type JsonSql = Pick<ReturnType<typeof postgres>, "json">;
type Sql = PostgreSqlExecutor & JsonSql;

export class PostgreSqlServerAutomationsStore implements ServerAutomationsStore {
  private readonly sql: ReturnType<typeof postgres>;

  private constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, {
      max: 10,
      onnotice: () => undefined,
      transform: { undefined: null },
    });
  }

  static async connect(databaseUrl: string): Promise<PostgreSqlServerAutomationsStore> {
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
      throw new Error("HASNA_AUTOMATIONS_DATABASE_URL must be a PostgreSQL URL");
    }
    const store = new PostgreSqlServerAutomationsStore(databaseUrl);
    try {
      await migratePostgreSql(store.sql as unknown as PostgreSqlExecutor);
      return store;
    } catch (error) {
      await store.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async createAutomation(spec: AutomationSpec): Promise<AutomationRecord> {
    validateAutomationSpec(spec);
    const now = new Date();
    const status = spec.status ?? "active";
    await this.sql.unsafe(
      `INSERT INTO automations (id,spec_json,status,created_at,updated_at)
       VALUES ($1,$2::jsonb,$3,$4,$4)
       ON CONFLICT (id) DO UPDATE SET
         spec_json=excluded.spec_json,status=excluded.status,updated_at=excluded.updated_at`,
      [spec.id, json(this.sql, { ...spec, status }), status, now],
    );
    return this.requireAutomation(spec.id);
  }

  async listAutomations(options: ListPageOptions = {}): Promise<AutomationRecord[]> {
    const page = normalizePageOptions(options);
    const rows = page.afterAt
      ? await this.sql.unsafe(
        `SELECT * FROM automations
         WHERE (created_at,id)>($1::timestamptz,$2::text)
         ORDER BY created_at,id LIMIT $3`,
        [page.afterAt, page.afterId, page.limit],
      )
      : await this.sql.unsafe("SELECT * FROM automations ORDER BY created_at,id LIMIT $1", [page.limit]);
    return rows.map(automationFromRow);
  }

  async requireAutomation(id: string): Promise<AutomationRecord> {
    return requireRow(await this.sql.unsafe("SELECT * FROM automations WHERE id=$1", [id]), `automation not found: ${id}`, automationFromRow);
  }

  async createWebhookRoute(input: CreateWebhookRouteInput): Promise<WebhookRoute> {
    await this.requireAutomation(input.automationId);
    const id = input.id ?? randomUUID();
    const path = normalizeWebhookPath(input.path ?? `/webhooks/${id}`);
    const status = input.status ?? "active";
    const signature = canonicalWebhookSignature(input.signature);
    validateWebhookRoute(id, status, input.mapping.source, input.mapping.type);
    const rows = await this.sql.unsafe(
      `INSERT INTO webhook_routes
         (id,automation_id,path,status,signature_json,mapping_json,created_at,updated_at,metadata_json)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$7,$8::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         automation_id=excluded.automation_id,path=excluded.path,status=excluded.status,
         signature_json=excluded.signature_json,mapping_json=excluded.mapping_json,
         updated_at=excluded.updated_at,metadata_json=excluded.metadata_json
       RETURNING *`,
      [
        id,
        input.automationId,
        path,
        status,
        json(this.sql, signature),
        json(this.sql, input.mapping),
        new Date(),
        json(this.sql, input.metadata),
      ],
    );
    return webhookFromRow(rows[0]!);
  }

  async listWebhookRoutes(options: ListPageOptions = {}): Promise<WebhookRoute[]> {
    const page = normalizePageOptions(options);
    const rows = page.afterAt
      ? await this.sql.unsafe(
        `SELECT * FROM webhook_routes
         WHERE (created_at,id)>($1::timestamptz,$2::text)
         ORDER BY created_at,id LIMIT $3`,
        [page.afterAt, page.afterId, page.limit],
      )
      : await this.sql.unsafe("SELECT * FROM webhook_routes ORDER BY created_at,id LIMIT $1", [page.limit]);
    return rows.map(webhookFromRow);
  }

  async countWebhookRoutes(): Promise<number> {
    const row = (await this.sql.unsafe<[{ count: string }]>("SELECT count(*)::text AS count FROM webhook_routes"))[0]!;
    return count(row.count);
  }

  async requireWebhookRoute(idOrPath: string): Promise<WebhookRoute> {
    return requireRow(
      await this.sql.unsafe("SELECT * FROM webhook_routes WHERE id=$1 OR path=$1 ORDER BY id LIMIT 1", [idOrPath]),
      `webhook route not found: ${idOrPath}`,
      webhookFromRow,
    );
  }

  async setWebhookRouteStatus(idOrPath: string, status: WebhookRouteStatus): Promise<WebhookRoute> {
    if (!(WEBHOOK_ROUTE_STATUSES as readonly string[]).includes(status)) throw new Error(`unsupported webhook route status: ${status}`);
    const route = await this.requireWebhookRoute(idOrPath);
    const rows = await this.sql.unsafe("UPDATE webhook_routes SET status=$2,updated_at=now() WHERE id=$1 RETURNING *", [route.id, status]);
    return webhookFromRow(rows[0]!);
  }

  async rotateWebhookRouteSecret(idOrPath: string, secretRef: string): Promise<WebhookRoute> {
    if (!secretRef.startsWith("secret://")) throw new Error("webhook route secretRef must be a secret:// reference");
    const route = await this.requireWebhookRoute(idOrPath);
    if (!route.signature) throw new Error(`webhook route has no signature config: ${route.id}`);
    const rows = await this.sql.unsafe(
      "UPDATE webhook_routes SET signature_json=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *",
      [route.id, json(this.sql, { ...route.signature, secretRef })],
    );
    return webhookFromRow(rows[0]!);
  }

  async createRun(input: CreateRunInput): Promise<AutomationRun> {
    return this.createRunWith(this.sql as unknown as Sql, input);
  }

  private async createRunWith(sql: Sql, input: CreateRunInput): Promise<AutomationRun> {
    const now = new Date();
    const rows = await sql.unsafe(
      `INSERT INTO automation_runs
         (id,automation_id,status,trigger_json,trigger_event_id,idempotency_key,created_at,updated_at,metadata_json)
       VALUES ($1,$2,'materialized',$3::jsonb,$4,$5,$6,$6,$7::jsonb)
       ON CONFLICT (automation_id,idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET idempotency_key=excluded.idempotency_key
       RETURNING *`,
      [
        input.id ?? randomUUID(),
        input.automationId,
        json(sql, input.trigger),
        input.triggerEventId ?? null,
        input.idempotencyKey ?? null,
        now,
        json(sql, input.metadata),
      ],
    );
    return runFromRow(rows[0]!);
  }

  async requireRun(id: string): Promise<AutomationRun> {
    return requireRow(await this.sql.unsafe("SELECT * FROM automation_runs WHERE id=$1", [id]), `automation run not found: ${id}`, runFromRow);
  }

  async listRuns(options: ListPageOptions = {}): Promise<AutomationRun[]> {
    const page = normalizePageOptions(options);
    const rows = page.afterAt
      ? await this.sql.unsafe(
        `SELECT * FROM automation_runs
         WHERE (created_at,id)>($1::timestamptz,$2::text)
         ORDER BY created_at,id LIMIT $3`,
        [page.afterAt, page.afterId, page.limit],
      )
      : await this.sql.unsafe("SELECT * FROM automation_runs ORDER BY created_at,id LIMIT $1", [page.limit]);
    return rows.map(runFromRow);
  }

  async enqueueAction(input: EnqueueActionInput): Promise<QueuedAction> {
    return this.enqueueActionWith(this.sql as unknown as Sql, input);
  }

  private async enqueueActionWith(sql: Sql, input: EnqueueActionInput): Promise<QueuedAction> {
    const now = new Date();
    const idempotencyKey = input.idempotencyKey ?? input.invocation.idempotencyKey ?? `${input.automationRunId}:${input.stepId}`;
    const rows = await sql.unsafe(
      `INSERT INTO automation_actions
         (id,automation_run_id,step_id,action_id,idempotency_key,status,invocation_json,attempt,max_attempts,
          available_at,created_at,updated_at,approval_gate_json,result_json,error_json,dead_letter_json,metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb)
       ON CONFLICT (automation_run_id,step_id) DO UPDATE SET step_id=excluded.step_id
      RETURNING *`,
      [input.id ?? randomUUID(), input.automationRunId, input.stepId, input.actionId, idempotencyKey, input.status ?? "queued",
        json(sql, input.invocation), input.attempt ?? 0, input.maxAttempts ?? 3, toDate(input.availableAt), now,
        json(sql, input.approvalGate), json(sql, input.result), json(sql, input.error), json(sql, input.deadLetter), json(sql, input.metadata)],
    );
    return actionFromRow(rows[0]!);
  }

  async requireQueuedAction(id: string): Promise<QueuedAction> {
    return requireRow(await this.sql.unsafe("SELECT * FROM automation_actions WHERE id=$1", [id]), `queued action not found: ${id}`, actionFromRow);
  }

  async listQueuedActions(options: ListPageOptions = {}): Promise<QueuedAction[]> {
    const page = normalizePageOptions(options);
    const rows = page.afterAt
      ? await this.sql.unsafe(
        `SELECT * FROM automation_actions
         WHERE (created_at,id)>($1::timestamptz,$2::text)
         ORDER BY created_at,id LIMIT $3`,
        [page.afterAt, page.afterId, page.limit],
      )
      : await this.sql.unsafe("SELECT * FROM automation_actions ORDER BY created_at,id LIMIT $1", [page.limit]);
    return rows.map(actionFromRow);
  }

  async listDeadActions(options: ListPageOptions = {}): Promise<QueuedAction[]> {
    const page = normalizePageOptions(options);
    const rows = page.afterAt
      ? await this.sql.unsafe(
        `SELECT * FROM automation_actions
         WHERE status='dead' AND (updated_at,id)>($1::timestamptz,$2::text)
         ORDER BY updated_at,id LIMIT $3`,
        [page.afterAt, page.afterId, page.limit],
      )
      : await this.sql.unsafe(
        "SELECT * FROM automation_actions WHERE status='dead' ORDER BY updated_at,id LIMIT $1",
        [page.limit],
      );
    return rows.map(actionFromRow);
  }

  async claimNextAction(options: QueueClaimOptions): Promise<LeasedQueuedAction | undefined> {
    const now = toDate(options.now);
    const expiresAt = new Date(now.getTime() + (options.leaseMs ?? 30_000));
    return this.sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      let readyCursor: Row | undefined;
      let expiredCursor: Row | undefined;
      while (true) {
        const ready = await sql.unsafe(
          `SELECT id,available_at,created_at FROM automation_actions
           WHERE status IN ('queued','retrying') AND available_at <= $1
             AND ($2::timestamptz IS NULL OR (available_at,created_at,id)>($2::timestamptz,$3::timestamptz,$4::text))
           ORDER BY available_at,created_at,id LIMIT $5`,
          [now, readyCursor?.available_at ?? null, readyCursor?.created_at ?? null, readyCursor?.id ?? "", CLAIM_CANDIDATE_WINDOW],
        );
        const expired = await sql.unsafe(
          `SELECT id,available_at,created_at,lease_expires_at FROM automation_actions
           WHERE status='claimed' AND available_at <= $1
             AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1
             AND ($2::timestamptz IS NULL OR (lease_expires_at,available_at,created_at,id)>($2::timestamptz,$3::timestamptz,$4::timestamptz,$5::text))
           ORDER BY lease_expires_at,available_at,created_at,id LIMIT $6`,
          [
            now,
            expiredCursor?.lease_expires_at ?? null,
            expiredCursor?.available_at ?? null,
            expiredCursor?.created_at ?? null,
            expiredCursor?.id ?? "",
            CLAIM_CANDIDATE_WINDOW,
          ],
        );
        if (ready.length === 0 && expired.length === 0) return undefined;
        readyCursor = ready.at(-1) ?? readyCursor;
        expiredCursor = expired.at(-1) ?? expiredCursor;
        const candidateIds = [...ready, ...expired]
          .sort(compareClaimCandidateRows)
          .map((candidate) => String(candidate.id));
        for (const candidateId of candidateIds) {
          const candidates = await sql.unsafe(
          `SELECT action.*,run.automation_id,automation.spec_json
           FROM automation_actions action
           JOIN automation_runs run ON run.id=action.automation_run_id
           JOIN automations automation ON automation.id=run.automation_id
           WHERE action.id=$1
             AND (action.status IN ('queued','retrying')
               OR (action.status='claimed' AND action.lease_expires_at IS NOT NULL AND action.lease_expires_at <= $2))
             AND action.available_at <= $2
             AND NOT EXISTS (
               SELECT 1 FROM automation_action_dependencies dependency
               JOIN automation_actions required ON required.id=dependency.dependency_action_id
               WHERE dependency.action_id=action.id AND required.status <> 'succeeded'
             )
           FOR UPDATE OF action SKIP LOCKED`,
          [candidateId, now],
        );
          const candidate = candidates[0];
          if (!candidate) continue;
          const approvalGate = nullableObject<ActionQueueApprovalGate>(candidate.approval_gate_json);
          if (!approvalAllowsClaim(approvalGate)) {
            await sql.unsafe("UPDATE automation_actions SET status='waiting_approval',updated_at=$2 WHERE id=$1 AND status<>'waiting_approval'", [candidate.id, now]);
            continue;
          }
          const spec = object<AutomationSpec>(candidate.spec_json);
          const concurrencyKey = spec.concurrency?.limit === 1 ? spec.concurrency.key : undefined;
          if (concurrencyKey && !(await acquireConcurrencyLock(sql, concurrencyKey, String(candidate.automation_run_id), now, expiresAt))) continue;
          const rows = await sql.unsafe(
          `UPDATE automation_actions SET
             status='claimed',claimed_by=$2,claimed_at=$3,lease_expires_at=$4,
             claim_version=claim_version+1,updated_at=$3
           WHERE id=$1
             AND (status IN ('queued','retrying')
               OR (status='claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $3))
           RETURNING *`,
          [candidate.id, options.runnerId, now, expiresAt],
        );
          if (rows.length === 0) continue;
          await sql.unsafe(
          "UPDATE automation_runs SET status='running',started_at=COALESCE(started_at,$2),updated_at=$2 WHERE id=$1",
          [candidate.automation_run_id, now],
        );
          return leasedActionFromRow(rows[0]!);
        }
      }
    });
  }

  async renewActionLease(options: RenewActionLeaseOptions): Promise<LeasedQueuedAction> {
    const now = toDate(options.now);
    const expiresAt = new Date(now.getTime() + (options.leaseMs ?? 30_000));
    return this.sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const rows = await sql.unsafe(
        `UPDATE automation_actions SET lease_expires_at=$5,updated_at=$4
         WHERE id=$1 AND status='claimed' AND claimed_by=$2 AND claim_version=$3
           AND lease_expires_at IS NOT NULL AND lease_expires_at > $4
         RETURNING *`,
        [options.actionId, options.runnerId, options.fenceToken, now, expiresAt],
      );
      const row = assertFencedRow(rows, options.actionId);
      await renewConcurrencyLock(sql, String(row.automation_run_id), now, expiresAt);
      return leasedActionFromRow(row);
    });
  }

  async completeActionFenced(options: FencedActionCompletionOptions): Promise<QueuedAction> {
    return this.writeFenced(options, "succeeded", options.result);
  }

  async failActionFenced(options: FencedActionFailureOptions): Promise<QueuedAction> {
    const current = await this.requireQueuedAction(options.actionId);
    const nextAttempt = current.attempt + 1;
    const retrying = options.error.retryable !== false && nextAttempt < current.maxAttempts;
    const now = toDate(options.now);
    const availableAt = retrying
      ? new Date(now.getTime() + (options.retryBackoffMs ?? defaultBackoffMs(nextAttempt)))
      : now;
    const deadLetter: ActionDeadLetter | undefined = retrying ? undefined : {
      reason: nextAttempt >= current.maxAttempts ? "max attempts exceeded" : "non-retryable action error",
      failedAt: now.toISOString(),
      lastError: options.error,
      attempts: nextAttempt,
      replayable: true,
    };
    return this.writeFenced(options, retrying ? "retrying" : "dead", undefined, options.error, nextAttempt, availableAt, deadLetter);
  }

  private async writeFenced(
    options: FencedActionCompletionOptions | FencedActionFailureOptions,
    status: "succeeded" | "retrying" | "dead",
    result?: ActionResult,
    error?: ActionError,
    attempt?: number,
    availableAt?: Date,
    deadLetter?: ActionDeadLetter,
  ): Promise<QueuedAction> {
    const now = toDate(options.now);
    return this.sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const rows = await sql.unsafe(
        `UPDATE automation_actions SET
           status=$5,result_json=$6::jsonb,error_json=$7::jsonb,dead_letter_json=$8::jsonb,
           attempt=COALESCE($9,attempt),available_at=COALESCE($10,available_at),lease_expires_at=NULL,updated_at=$4
         WHERE id=$1 AND status='claimed' AND claimed_by=$2 AND claim_version=$3
           AND lease_expires_at IS NOT NULL AND lease_expires_at > $4
         RETURNING *`,
        [
          options.actionId,
          options.runnerId,
          options.fenceToken,
          now,
          status,
          json(sql, result),
          json(sql, error),
          json(sql, deadLetter),
          attempt ?? null,
          availableAt ?? null,
        ],
      );
      const row = assertFencedRow(rows, options.actionId);
      await settleRunAndConcurrencyLock(sql, String(row.automation_run_id), status, now, availableAt);
      return actionFromRow(row);
    });
  }

  async requeueDeadAction(id: string, options: { now?: string | Date; requestedBy?: string; reason?: string } = {}): Promise<QueuedAction> {
    const now = toDate(options.now);
    return this.sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const rows = await sql.unsafe("SELECT * FROM automation_actions WHERE id=$1 FOR UPDATE", [id]);
      const action = actionFromRow(requireRawRow(rows, `queued action not found: ${id}`));
      if (action.status !== "dead") throw new Error(`queued action is not dead: ${id}`);
      if (action.deadLetter?.replayable === false) throw new Error(`queued action is not replayable: ${id}`);
      await this.createReplayRequestWith(sql, {
        sourceRunId: action.automationRunId,
        mode: "dead-actions",
        requestedAt: now,
        requestedBy: options.requestedBy,
        reason: options.reason ?? `requeue dead action ${id}`,
        metadata: { actionId: id },
      });
      const updated = await sql.unsafe(
        `UPDATE automation_actions SET status='queued',attempt=0,available_at=$2,
           claimed_by=NULL,claimed_at=NULL,lease_expires_at=NULL,result_json=NULL,error_json=NULL,
           dead_letter_json=NULL,updated_at=$2
         WHERE id=$1 AND status='dead' RETURNING *`,
        [id, now],
      );
      await sql.unsafe("UPDATE automation_runs SET status='materialized',completed_at=NULL,error=NULL,updated_at=$2 WHERE id=$1", [action.automationRunId, now]);
      return actionFromRow(assertFencedRow(updated, id));
    });
  }

  async approveAction(id: string, options: { now?: string | Date; decidedBy?: string; reason?: string } = {}): Promise<QueuedAction> {
    return this.decideAction(id, "approved", options);
  }

  async rejectAction(id: string, options: { now?: string | Date; decidedBy?: string; reason?: string } = {}): Promise<QueuedAction> {
    return this.decideAction(id, "rejected", options);
  }

  private async decideAction(
    id: string,
    decisionStatus: "approved" | "rejected",
    options: { now?: string | Date; decidedBy?: string; reason?: string },
  ): Promise<QueuedAction> {
    const now = toDate(options.now);
    return this.sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const row = requireRawRow(await sql.unsafe("SELECT * FROM automation_actions WHERE id=$1 FOR UPDATE", [id]), `queued action not found: ${id}`);
      const action = actionFromRow(row);
      assertApprovalTransition(action, decisionStatus === "approved" ? "approve" : "reject");
      const decision: ActionQueueApprovalDecision = {
        id: randomUUID(), status: decisionStatus,
        requestedAt: action.approvalGate!.decision?.requestedAt ?? action.createdAt,
        decidedAt: now.toISOString(), reason: options.reason,
        metadata: options.decidedBy ? { decidedBy: options.decidedBy } : undefined,
      };
      const gate: ActionQueueApprovalGate = {
        ...action.approvalGate!, blockedUntilApproved: decisionStatus !== "approved", decision,
      };
      const deadLetter: ActionDeadLetter | undefined = decisionStatus === "rejected" ? {
        reason: options.reason ?? "approval rejected", failedAt: now.toISOString(), attempts: action.attempt,
        replayable: false, metadata: { approvalDecisionId: decision.id },
      } : undefined;
      const updated = await sql.unsafe(
        `UPDATE automation_actions SET status=$2,approval_gate_json=$3::jsonb,dead_letter_json=$4::jsonb,updated_at=$5
         WHERE id=$1 AND status IN ('queued','waiting_approval')
           AND claimed_by IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL RETURNING *`,
        [id, decisionStatus === "approved" ? "queued" : "dead", json(sql, gate), json(sql, deadLetter), now],
      );
      return actionFromRow(assertFencedRow(updated, id));
    });
  }

  async materializeEvent(event: EventEnvelopeLike, options: { automationId?: string } = {}): Promise<MaterializedEventRun[]> {
    return this.materializeEventWithContext(event, { automationId: options.automationId });
  }

  private async materializeEventWithContext(
    event: EventEnvelopeLike,
    options: { automationId?: string; webhookRoute?: WebhookRoute } = {},
  ): Promise<MaterializedEventRun[]> {
    return this.sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const rows = options.automationId
        ? await sql.unsafe("SELECT * FROM automations WHERE status='active' AND id=$1", [options.automationId])
        : await selectEventCandidateRows(sql, event);
      const materialized: MaterializedEventRun[] = [];
      const seenAutomations = new Set<string>();
      for (const row of rows) {
        const automation = automationFromRow(row);
        if (seenAutomations.has(automation.id)) continue;
        seenAutomations.add(automation.id);
        const trigger = automation.spec.triggers.find((candidate) => triggerMatchesEvent(candidate, event, automation, options.webhookRoute));
        if (!trigger) continue;
        const identity = event.dedupeKey ?? event.id;
        const run = await this.createRunWith(sql, {
          automationId: automation.id, trigger, triggerEventId: event.id,
          idempotencyKey: `${automation.id}:${identity}`,
          metadata: eventRunMetadata(event),
        });
        const actions: QueuedAction[] = [];
        const byStep = new Map<string, QueuedAction>();
        for (const step of automation.spec.actions) {
          const action = await this.enqueueActionWith(sql, {
            automationRunId: run.id, stepId: step.id, actionId: step.actionId,
            invocation: {
              id: deterministicInvocationId(run.id, step.id), actionId: step.actionId,
              manifestVersion: step.manifestVersion ?? "1.0.0", input: step.input ?? {},
              automationId: automation.id, runId: run.id, requestedAt: toDate(event.time).toISOString(),
              idempotencyKey: `${automation.id}:${identity}:${step.id}`, metadata: eventActionMetadata(event),
            },
            availableAt: event.time,
            approvalGate: materializeApprovalGate(step, toDate(event.time).toISOString()),
          });
          actions.push(action);
          byStep.set(step.id, action);
        }
        for (const step of automation.spec.actions) {
          for (const dependency of step.dependsOn ?? []) {
            await sql.unsafe(
              `INSERT INTO automation_action_dependencies (automation_run_id,action_id,dependency_action_id)
               VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
              [run.id, byStep.get(step.id)!.id, byStep.get(dependency)!.id],
            );
          }
        }
        materialized.push({ automation, run, actions });
      }
      return materialized;
    });
  }

  async materializeWebhookRequest(input: WebhookRequestInput): Promise<MaterializedWebhookRequest> {
    const route = await this.requireWebhookRoute(input.route.id);
    if (route.status !== "active") throw new Error(`webhook route is not active: ${route.id}`);
    if (route.automationId !== input.route.automationId) throw new Error(`webhook route automation scope changed: ${route.id}`);
    const event = normalizeWebhookRequestToEvent({ ...input, route });
    const materialized = await this.materializeEventWithContext(event, { automationId: route.automationId, webhookRoute: route });
    return { route, event, materialized };
  }

  async createReplayRequest(input: CreateReplayRequestInput): Promise<AutomationReplayRequest> {
    return this.createReplayRequestWith(this.sql as unknown as Sql, input);
  }

  private async createReplayRequestWith(sql: Sql, input: CreateReplayRequestInput): Promise<AutomationReplayRequest> {
    const actionId = typeof input.metadata?.actionId === "string" ? input.metadata.actionId : "all";
    const replayIdentity = `${input.sourceRunId}:${input.mode}:${actionId}`;
    const rows = await sql.unsafe(
      `INSERT INTO automation_replay_requests
         (id,source_run_id,replay_identity,requested_at,requested_by,mode,reason,metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (replay_identity) DO UPDATE SET replay_identity=excluded.replay_identity
       RETURNING *`,
      [
        input.id ?? randomUUID(),
        input.sourceRunId,
        replayIdentity,
        toDate(input.requestedAt),
        input.requestedBy ?? null,
        input.mode,
        input.reason ?? null,
        json(sql, input.metadata),
      ],
    );
    return replayFromRow(rows[0]!);
  }

  async requireReplayRequest(id: string): Promise<AutomationReplayRequest> {
    return requireRow(await this.sql.unsafe("SELECT * FROM automation_replay_requests WHERE id=$1", [id]), `replay request not found: ${id}`, replayFromRow);
  }

  async heartbeatDaemon(input: DaemonHeartbeatInput = {}) {
    const now = input.now ?? new Date();
    const id = input.leaseId ?? `daemon:${hostname()}:${process.pid}`;
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 30_000));
    const rows = await this.sql.unsafe(
      `INSERT INTO daemon_leases (id,pid,hostname,heartbeat_at,expires_at,created_at,updated_at,metadata_json)
       VALUES ($1,$2,$3,$4,$5,$4,$4,$6::jsonb)
       ON CONFLICT (id) DO UPDATE SET pid=excluded.pid,hostname=excluded.hostname,
         heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at,
         updated_at=excluded.updated_at,metadata_json=excluded.metadata_json
       RETURNING *`,
      [id, process.pid, hostname(), now, expiresAt, json(this.sql, input.metadata)],
    );
    return daemonFromRow(rows[0]!);
  }

  async latestDaemonLease() {
    const row = (await this.sql.unsafe("SELECT * FROM daemon_leases ORDER BY updated_at DESC,id LIMIT 1"))[0];
    return row ? daemonFromRow(row) : undefined;
  }

  async status(now = new Date()): Promise<AutomationsStatus> {
    const [counts, lease] = await Promise.all([
      this.sql.unsafe(`SELECT
        (SELECT count(*) FROM automations)::text AS automations,
        (SELECT count(*) FROM automation_runs)::text AS runs,
        (SELECT count(*) FROM automation_actions)::text AS queued_actions,
        (SELECT count(*) FROM automation_actions WHERE status='dead')::text AS dead_actions,
        (SELECT count(*) FROM automation_replay_requests)::text AS replay_requests,
        (SELECT count(*) FROM webhook_routes)::text AS webhook_routes`),
      this.latestDaemonLease(),
    ]);
    const row = counts[0]!;
    return {
      service: "automations", schemaVersion: AUTOMATION_SCHEMA_VERSION,
      dataDir: "postgresql", dbPath: "postgresql",
      counts: {
        automations: count(row.automations), runs: count(row.runs), queuedActions: count(row.queued_actions),
        deadActions: count(row.dead_actions), replayRequests: count(row.replay_requests), webhookRoutes: count(row.webhook_routes),
      },
      daemon: {
        leaseId: lease?.id, pid: lease?.pid, hostname: lease?.hostname,
        heartbeatAt: lease?.heartbeat_at, expiresAt: lease?.expires_at,
        active: lease ? new Date(lease.expires_at).getTime() > now.getTime() : false,
        metadata: lease?.metadata_json ? JSON.parse(lease.metadata_json) as JsonObject : undefined,
      },
    };
  }
}

async function acquireConcurrencyLock(sql: Sql, key: string, runId: string, now: Date, expiresAt: Date): Promise<boolean> {
  const rows = await sql.unsafe(
    `INSERT INTO automation_concurrency_locks
       (concurrency_key,owner_run_id,fence_token,acquired_at,expires_at,updated_at)
     VALUES ($1,$2,1,$3,$4,$3)
     ON CONFLICT (concurrency_key) DO UPDATE SET
       owner_run_id=excluded.owner_run_id,
       fence_token=automation_concurrency_locks.fence_token+1,
       acquired_at=excluded.acquired_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at
     WHERE automation_concurrency_locks.owner_run_id=excluded.owner_run_id
        OR automation_concurrency_locks.expires_at <= $3
     RETURNING owner_run_id`,
    [key, runId, now, expiresAt],
  );
  return rows[0]?.owner_run_id === runId;
}

async function renewConcurrencyLock(sql: Sql, runId: string, now: Date, expiresAt: Date): Promise<void> {
  await sql.unsafe(
    "UPDATE automation_concurrency_locks SET expires_at=$3,updated_at=$2 WHERE owner_run_id=$1 AND expires_at > $2",
    [runId, now, expiresAt],
  );
}

async function settleRunAndConcurrencyLock(sql: Sql, runId: string, status: string, now: Date, availableAt?: Date): Promise<void> {
  const remaining = await sql.unsafe<{ count: string }>(
    "SELECT count(*)::text AS count FROM automation_actions WHERE automation_run_id=$1 AND status NOT IN ('succeeded','dead','rejected','cancelled')",
    [runId],
  );
  if (count(remaining[0]!.count) === 0) {
    const failed = status === "dead" || (await sql.unsafe<{ count: string }>(
      "SELECT count(*)::text AS count FROM automation_actions WHERE automation_run_id=$1 AND status IN ('dead','rejected')",
      [runId],
    )).some((row) => count(row.count) > 0);
    await sql.unsafe(
      "UPDATE automation_runs SET status=$2,completed_at=$3,updated_at=$3 WHERE id=$1",
      [runId, failed ? "failed" : "succeeded", now],
    );
    await sql.unsafe("DELETE FROM automation_concurrency_locks WHERE owner_run_id=$1", [runId]);
    return;
  }
  const lockExpiresAt = availableAt && availableAt > now ? new Date(availableAt.getTime() + 30_000) : new Date(now.getTime() + 30_000);
  await sql.unsafe("UPDATE automation_concurrency_locks SET expires_at=$2,updated_at=$3 WHERE owner_run_id=$1", [runId, lockExpiresAt, now]);
}

function triggerMatchesEvent(trigger: AutomationTrigger, event: EventEnvelopeLike, automation: AutomationRecord, webhookRoute?: WebhookRoute): boolean {
  if (trigger.kind === "webhook") {
    if (!webhookRoute || webhookRoute.automationId !== automation.id) return false;
    const webhook = event.metadata?.webhook;
    if (!isPlainObject(webhook) || webhook.routeId !== webhookRoute.id) return false;
  }
  if (trigger.kind !== "event" && trigger.kind !== "webhook") return false;
  if (trigger.source && trigger.source !== event.source) return false;
  if (trigger.type && trigger.type !== event.type) return false;
  if (trigger.subject && trigger.subject !== event.subject) return false;
  return Object.entries(trigger.filter ?? {}).every(([key, expected]) => {
    const observed = (event.data ?? {})[key];
    return isPlainObject(expected) && "not" in expected ? observed !== expected.not : observed === expected;
  });
}

function materializeApprovalGate(step: AutomationActionStep, requestedAt: string): ActionQueueApprovalGate | undefined {
  const requirement = step.approval ?? step.approvalGate?.requirement;
  if (!requirement?.requiresApproval) return undefined;
  return { requirement, blockedUntilApproved: true, decision: { id: randomUUID(), status: "pending", requestedAt } };
}

function approvalAllowsClaim(gate?: ActionQueueApprovalGate): boolean {
  if (!gate?.requirement.requiresApproval) return true;
  return gate.blockedUntilApproved === false && gate.decision?.status === "approved";
}

function assertApprovalTransition(action: QueuedAction, operation: "approve" | "reject"): void {
  if (!action.approvalGate) throw new Error(`queued action has no approval gate: ${action.id}`);
  if (isTerminalActionQueueStatus(action.status)) throw new Error(`cannot ${operation} terminal queued action: ${action.id}`);
  if (action.status === "claimed" || action.claimedBy || action.claimedAt || action.leaseExpiresAt) throw new Error(`cannot ${operation} claimed queued action: ${action.id}`);
  if (action.status !== "queued" && action.status !== "waiting_approval") throw new Error(`queued action is not awaiting approval: ${action.id}`);
  if (action.approvalGate.decision?.status !== "pending") throw new Error(`queued action approval decision is not pending: ${action.id}`);
}

function eventRunMetadata(event: EventEnvelopeLike): JsonObject {
  return { eventSource: event.source, eventType: event.type, ...(event.dedupeKey ? { eventDedupeKey: event.dedupeKey } : {}) };
}

function eventActionMetadata(event: EventEnvelopeLike): JsonObject {
  return { eventId: event.id, ...(event.dedupeKey ? { eventDedupeKey: event.dedupeKey } : {}) };
}

function deterministicInvocationId(runId: string, stepId: string): string {
  return `invocation:${runId}:${stepId}`;
}

function canonicalWebhookSignature(signature?: WebhookSignatureConfig): WebhookSignatureConfig | undefined {
  if (!signature) return undefined;
  if (signature.algorithm !== "hmac-sha256") throw new Error(`unsupported webhook signature algorithm: ${signature.algorithm}`);
  if (!signature.secretRef.startsWith("secret://")) throw new Error("webhook signature secretRef must be a secret:// reference");
  if (signature.encoding && signature.encoding !== "hex" && signature.encoding !== "base64") throw new Error(`unsupported webhook signature encoding: ${signature.encoding}`);
  return signature;
}

function validateWebhookRoute(id: string, status: string, source: string, type: string): void {
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id)) throw new Error("webhook route id is invalid");
  if (!(WEBHOOK_ROUTE_STATUSES as readonly string[]).includes(status)) throw new Error(`unsupported webhook route status: ${status}`);
  if (!source) throw new Error("webhook route mapping.source is required");
  if (!type) throw new Error("webhook route mapping.type is required");
}

function normalizeWebhookPath(path: string): string {
  if (!path.startsWith("/")) throw new Error("webhook route path must start with /");
  if (path.includes("?") || path.includes("#")) throw new Error("webhook route path must not include query or fragment");
  if (path.includes("..")) throw new Error("webhook route path must not contain ..");
  return path.replace(/\/+/g, "/");
}

function defaultBackoffMs(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 1_000;
const CLAIM_CANDIDATE_WINDOW = 50;

function normalizePageOptions(options: ListPageOptions): { limit: number; afterAt: Date | null; afterId: string } {
  const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new Error(`list limit must be a positive number no greater than ${MAX_PAGE_LIMIT}`);
  }
  if (!options.after) return { limit, afterAt: null, afterId: "" };
  if (!options.after.id) throw new Error("list cursor id is required");
  return { limit, afterAt: toDate(options.after.createdAt), afterId: options.after.id };
}

function compareClaimCandidateRows(left: Row, right: Row): number {
  const available = toDate(left.available_at as string | Date).getTime() - toDate(right.available_at as string | Date).getTime();
  if (available !== 0) return available;
  const created = toDate(left.created_at as string | Date).getTime() - toDate(right.created_at as string | Date).getTime();
  return created || String(left.id).localeCompare(String(right.id));
}

const EVENT_SOURCE_WILDCARD_PREDICATE = `spec_json @? '$.triggers[*] ? (@.kind == "event" && !exists(@.source))'::jsonpath`;

async function selectEventCandidateRows(sql: Sql, event: EventEnvelopeLike): Promise<Row[]> {
  if (event.source === undefined) {
    return sql.unsafe(
      `SELECT * FROM automations
       WHERE status='active' AND ${EVENT_SOURCE_WILDCARD_PREDICATE}
       ORDER BY created_at,id`,
    );
  }
  return sql.unsafe(
    `SELECT * FROM (
       SELECT * FROM automations
       WHERE status='active' AND event_sources @> $1::jsonb
       UNION ALL
       SELECT * FROM automations
       WHERE status='active' AND ${EVENT_SOURCE_WILDCARD_PREDICATE}
     ) candidate
     ORDER BY created_at,id`,
    [json(sql, [event.source])],
  );
}

function json(sql: JsonSql, value: unknown): ReturnType<JsonSql["json"]> | null {
  return value === undefined ? null : sql.json(value as never);
}

function toDate(value?: string | Date): Date {
  const result = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(result.getTime())) throw new Error(`invalid date: ${String(value)}`);
  return result;
}

function iso(value: unknown): string {
  return toDate(value instanceof Date ? value : String(value)).toISOString();
}

function object<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function nullableObject<T>(value: unknown): T | undefined {
  return value === null || value === undefined ? undefined : object<T>(value);
}

function count(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`unsafe PostgreSQL number: ${String(value)}`);
  return result;
}

function requireRawRow(rows: Row[], message: string): Row {
  if (!rows[0]) throw new Error(message);
  return rows[0];
}

function requireRow<T>(rows: Row[], message: string, convert: (row: Row) => T): T {
  return convert(requireRawRow(rows, message));
}

function assertFencedRow(rows: Row[], actionId: string): Row {
  if (rows.length !== 1) throw new Error(`stale or expired action lease: ${actionId}`);
  return rows[0]!;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function automationFromRow(row: Row): AutomationRecord {
  return { id: String(row.id), spec: object(row.spec_json), status: String(row.status) as AutomationRecord["status"], createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function webhookFromRow(row: Row): WebhookRoute {
  return { id: String(row.id), automationId: String(row.automation_id), path: String(row.path), status: String(row.status) as WebhookRoute["status"], signature: nullableObject(row.signature_json), mapping: object(row.mapping_json), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), metadata: nullableObject(row.metadata_json) };
}

function runFromRow(row: Row): AutomationRun {
  return { id: String(row.id), automationId: String(row.automation_id), status: String(row.status) as AutomationRun["status"], trigger: object(row.trigger_json), triggerEventId: row.trigger_event_id == null ? undefined : String(row.trigger_event_id), idempotencyKey: row.idempotency_key == null ? undefined : String(row.idempotency_key), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), startedAt: row.started_at == null ? undefined : iso(row.started_at), completedAt: row.completed_at == null ? undefined : iso(row.completed_at), error: row.error == null ? undefined : String(row.error), metadata: nullableObject(row.metadata_json) };
}

function actionFromRow(row: Row): QueuedAction {
  return { id: String(row.id), automationRunId: String(row.automation_run_id), stepId: String(row.step_id), actionId: String(row.action_id), idempotencyKey: String(row.idempotency_key), status: String(row.status) as QueuedAction["status"], invocation: object(row.invocation_json), attempt: count(row.attempt), maxAttempts: count(row.max_attempts), availableAt: iso(row.available_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), claimedBy: row.claimed_by == null ? undefined : String(row.claimed_by), claimedAt: row.claimed_at == null ? undefined : iso(row.claimed_at), leaseExpiresAt: row.lease_expires_at == null ? undefined : iso(row.lease_expires_at), approvalGate: nullableObject(row.approval_gate_json), result: nullableObject(row.result_json), error: nullableObject(row.error_json), deadLetter: nullableObject(row.dead_letter_json), metadata: nullableObject(row.metadata_json) };
}

function leasedActionFromRow(row: Row): LeasedQueuedAction {
  return { ...actionFromRow(row), fenceToken: count(row.claim_version) };
}

function replayFromRow(row: Row): AutomationReplayRequest {
  return { id: String(row.id), sourceRunId: String(row.source_run_id), requestedAt: iso(row.requested_at), requestedBy: row.requested_by == null ? undefined : String(row.requested_by), mode: String(row.mode) as AutomationReplayRequest["mode"], reason: row.reason == null ? undefined : String(row.reason), metadata: nullableObject(row.metadata_json) };
}

function daemonFromRow(row: Row) {
  return { id: String(row.id), pid: count(row.pid), hostname: String(row.hostname), heartbeat_at: iso(row.heartbeat_at), expires_at: iso(row.expires_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at), metadata_json: row.metadata_json == null ? null : JSON.stringify(row.metadata_json) };
}
