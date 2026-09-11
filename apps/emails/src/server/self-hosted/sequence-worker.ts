import { WORKER_CLAIM_CTE, type WorkerFence } from "./worker-supervisor.js";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import { renderTemplate } from "../../db/templates.js";
import { runScheduledBatch } from "./scheduler.js";

type Row = Record<string, unknown>;
export class SequenceWorkerStore {
  constructor(
    private readonly client: TypedQueryClient,
    private readonly tenantId: string,
    private readonly workerFence?: WorkerFence,
  ) {}

  async claim(limit: number): Promise<Row[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError("Sequence limit must be 1–100");
    return this.client.many<Row>(
      `${this.workerFence ? WORKER_CLAIM_CTE : "WITH"} due AS (
      SELECT e.id FROM sequence_enrollments e JOIN sequences s ON s.id=e.sequence_id AND s.tenant_id=e.tenant_id
      WHERE e.tenant_id=$1 AND e.status='active' ${this.workerFence ? 'AND EXISTS(SELECT 1 FROM worker_guard)' : ''} AND s.status='active' AND e.next_send_at <= now()
        AND (e.execution_lease IS NULL OR e.execution_lease < now()-interval '5 minutes')
      ORDER BY e.next_send_at,e.id FOR UPDATE OF e SKIP LOCKED LIMIT $2
    ) UPDATE sequence_enrollments e SET execution_lease=date_trunc('milliseconds',clock_timestamp()), updated_at=now()
      FROM due WHERE e.id=due.id AND e.tenant_id=$1 RETURNING e.*`,
      [this.tenantId, limit, ...(this.workerFence ? [this.workerFence.id,this.workerFence.generation,this.workerFence.ownerHash] : [])],
    );
  }

  async prepare(row: Row): Promise<Row | null> {
    if (row.execution_payload) return row.execution_payload as Row;
    const duplicates = await this.client.many<Row>(
      `SELECT id FROM sequence_enrollments WHERE tenant_id=$1 AND sequence_id=$2 AND lower(contact_email)=lower($3) AND status='active' LIMIT 2`,
      [this.tenantId, row.sequence_id, row.contact_email],
    );
    if (duplicates.length > 1)
      throw new Error(
        "Duplicate active enrollments for this recipient; cancel the duplicate before execution",
      );
    const stepIndex = Number(row.current_step);
    if (!Number.isSafeInteger(stepIndex) || stepIndex < 0)
      throw new Error("Sequence step position is invalid");
    const steps = await this.client.many<Row>(
      `SELECT * FROM sequence_steps WHERE tenant_id=$1 AND sequence_id=$2 ORDER BY step_number,created_at,id COLLATE "C" OFFSET $3 LIMIT 2`,
      [this.tenantId, row.sequence_id, stepIndex],
    );
    const step = steps[0];
    const next = steps[1];
    let snapshot: Row;
    if (!step) snapshot = { complete: true };
    else {
      const template = await this.client.get<Row>(
        `SELECT subject_template,text_template,html_template FROM templates WHERE tenant_id=$1 AND name=$2 LIMIT 1`,
        [this.tenantId, step.template_name],
      );
      if (!template)
        throw new Error(`Sequence template is missing: ${step.template_name}`);
      let from = step.from_address;
      if (!from) {
        const addresses = await this.client.many<Row>(
          `SELECT email FROM addresses WHERE tenant_id=$1 AND status='active' AND ($2::text IS NULL OR provider_id=$2) ORDER BY email LIMIT 2`,
          [this.tenantId, row.provider_id ?? null],
        );
        if (addresses.length !== 1)
          throw new Error(
            "Sequence step needs an explicit From address when no unique active sender exists",
          );
        from = addresses[0]!.email;
      }
      const delay = next ? Number(next.delay_hours) : null;
      if (
        delay !== null &&
        (!Number.isFinite(delay) || delay < 0 || delay > 87600)
      )
        throw new Error("Sequence delay must be between 0 and 87600 hours");
      const vars = { email: String(row.contact_email) };
      snapshot = {
        id: `sequence:${row.id}:${stepIndex}`,
        from_address: from,
        to_addresses: [row.contact_email],
        subject: renderTemplate(
          String(step.subject_override || template.subject_template || ""),
          vars,
        ),
        text_body:
          template.text_template == null
            ? undefined
            : renderTemplate(String(template.text_template), vars),
        html:
          template.html_template == null
            ? undefined
            : renderTemplate(String(template.html_template), vars),
        provider_id: row.provider_id,
        next_delay_hours: delay,
        step_id: step.id,
      };
    }
    const saved = await this.client.get<Row>(
      `UPDATE sequence_enrollments SET execution_payload=$4::jsonb,execution_started=true
      WHERE tenant_id=$1 AND id=$2 AND execution_lease=$3::timestamptz AND status='active' AND execution_payload IS NULL RETURNING execution_payload`,
      [this.tenantId, row.id, row.execution_lease, JSON.stringify(snapshot)],
    );
    return saved ? (saved.execution_payload as Row) : null;
  }

  async isCurrent(row: Row): Promise<boolean> {
    return (
      (await this.client.get<Row>(
        `SELECT e.id FROM sequence_enrollments e JOIN sequences s ON s.id=e.sequence_id AND s.tenant_id=e.tenant_id
      WHERE e.tenant_id=$1 AND e.id=$2 AND e.execution_lease=$3::timestamptz AND e.status='active' AND s.status='active'`,
        [this.tenantId, row.id, row.execution_lease],
      )) !== null
    );
  }

  async finish(
    row: Row,
    snapshot: Row | null,
    outcome: "sent" | "failed",
    error: string | null,
  ): Promise<boolean> {
    const complete =
      outcome === "sent" &&
      (snapshot?.complete === true || snapshot?.next_delay_hours == null);
    const result = await this.client.get<Row>(
      `UPDATE sequence_enrollments SET
      current_step=current_step+CASE WHEN $4='sent' THEN 1 ELSE 0 END,
      status=CASE WHEN $5 THEN 'completed' ELSE status END,
      completed_at=CASE WHEN $5 THEN now() ELSE completed_at END,
      next_send_at=CASE WHEN $5 THEN NULL WHEN $4='sent' THEN now()+($6::double precision * interval '1 hour') ELSE now()+interval '5 minutes' END,
      execution_payload=CASE WHEN $4='sent' THEN NULL ELSE execution_payload END,
      execution_error=$7,execution_lease=NULL,updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND execution_lease=$3::timestamptz AND status='active' AND current_step=$8 RETURNING id`,
      [
        this.tenantId,
        row.id,
        row.execution_lease,
        outcome,
        complete,
        snapshot?.next_delay_hours ?? 0,
        error,
        row.current_step,
      ],
    );
    return result !== null;
  }
}

/** Reuses the scheduler's send receipts and the normal authenticated send policy. */
export async function runSequenceBatch(
  store: SequenceWorkerStore,
  send: (body: Row) => Promise<Response>,
  limit = 10,
) {
  const claimed = await store.claim(limit);
  const sequences = {
    attempted: claimed.length,
    sent: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
  };
  const items: Array<{ id: string; status: string; error?: string }> = [];
  for (const row of claimed) {
    let snapshot: Row | null = null;
    try {
      snapshot = await store.prepare(row);
      if (!snapshot) {
        sequences.pending++;
        items.push({ id: String(row.id), status: "lease_lost" });
        continue;
      }
      if (!(await store.isCurrent(row))) {
        sequences.pending++;
        items.push({ id: String(row.id), status: "lease_lost" });
        continue;
      }
      if (snapshot.complete) {
        const done = await store.finish(row, snapshot, "sent", null);
        sequences[done ? "skipped" : "pending"]++;
        items.push({
          id: String(row.id),
          status: done ? "completed" : "lease_lost",
        });
        continue;
      }
      const result = await runScheduledBatch(
        {
          claimDueScheduled: async () => [
            { ...snapshot, updated_at: row.execution_lease },
          ],
          getScheduledTemplate: async () => null,
          finishScheduled: async (_id, _lease, status, error) =>
            store.finish(row, snapshot, status, error),
        },
        send,
        1,
      );
      for (const key of ["sent", "failed", "pending", "skipped"] as const)
        sequences[key] += result.scheduled[key];
      items.push(
        ...result.items.map((item) => ({ ...item, id: String(row.id) })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finished = await store.finish(row, snapshot, "failed", message);
      sequences[finished ? "failed" : "pending"]++;
      items.push({
        id: String(row.id),
        status: finished ? "failed" : "lease_lost",
        error: message,
      });
    }
  }
  return { sequences, sequence_items: items };
}
