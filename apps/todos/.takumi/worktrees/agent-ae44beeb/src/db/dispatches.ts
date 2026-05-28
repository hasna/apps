import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";
import type {
  CreateDispatchInput,
  Dispatch,
  DispatchLog,
  DispatchRow,
  DispatchStatus,
  ListDispatchesFilter,
} from "../types/index.js";
import { DispatchNotFoundError } from "../types/index.js";

function rowToDispatch(row: DispatchRow): Dispatch {
  return {
    ...row,
    task_ids: (() => {
      try {
        return JSON.parse(row.task_ids) as string[];
      } catch {
        return [];
      }
    })(),
    status: row.status as DispatchStatus,
  };
}

export function createDispatch(input: CreateDispatchInput, db?: Database): Dispatch {
  const _db = db ?? getDatabase();
  const id = uuid();
  const taskIds = JSON.stringify(input.task_ids ?? []);

  _db.run(
    `INSERT INTO dispatches
      (id, title, target_window, task_ids, task_list_id, message, delay_ms, scheduled_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      id,
      input.title ?? null,
      input.target_window,
      taskIds,
      input.task_list_id ?? null,
      input.message ?? null,
      input.delay_ms ?? null,
      input.scheduled_at ?? null,
      now(),
    ],
  );

  const row = _db.query("SELECT * FROM dispatches WHERE id = ?").get(id) as DispatchRow;
  return rowToDispatch(row);
}

export function getDispatch(id: string, db?: Database): Dispatch {
  const _db = db ?? getDatabase();
  const row = _db.query("SELECT * FROM dispatches WHERE id = ?").get(id) as DispatchRow | null;
  if (!row) throw new DispatchNotFoundError(id);
  return rowToDispatch(row);
}

export function listDispatches(filter: ListDispatchesFilter = {}, db?: Database): Dispatch[] {
  const _db = db ?? getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;

  const rows = _db
    .query(`SELECT * FROM dispatches ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...[...params, limit, offset] as any) as DispatchRow[];

  return rows.map(rowToDispatch);
}

export function cancelDispatch(id: string, db?: Database): Dispatch {
  const _db = db ?? getDatabase();
  const existing = getDispatch(id, _db);

  if (existing.status === "sent" || existing.status === "cancelled") {
    throw new Error(
      `Cannot cancel dispatch with status "${existing.status}" — only pending dispatches can be cancelled`,
    );
  }

  _db.run("UPDATE dispatches SET status = 'cancelled' WHERE id = ?", [id]);
  return getDispatch(id, _db);
}

export function updateDispatchStatus(
  id: string,
  status: DispatchStatus,
  opts: { error?: string; sent_at?: string } = {},
  db?: Database,
): void {
  const _db = db ?? getDatabase();
  _db.run(
    "UPDATE dispatches SET status = ?, error = ?, sent_at = ? WHERE id = ?",
    [status, opts.error ?? null, opts.sent_at ?? null, id],
  );
}

export function createDispatchLog(
  log: Omit<DispatchLog, "id" | "created_at">,
  db?: Database,
): DispatchLog {
  const _db = db ?? getDatabase();
  const id = uuid();
  const created_at = now();

  _db.run(
    `INSERT INTO dispatch_logs (id, dispatch_id, target_window, message, delay_ms, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, log.dispatch_id, log.target_window, log.message, log.delay_ms, log.status, log.error ?? null, created_at],
  );

  return { ...log, id, created_at };
}

export function listDispatchLogs(dispatchId: string, db?: Database): DispatchLog[] {
  const _db = db ?? getDatabase();
  return _db
    .query("SELECT * FROM dispatch_logs WHERE dispatch_id = ? ORDER BY created_at ASC")
    .all(dispatchId) as DispatchLog[];
}

/** Return all dispatches that are ready to fire (pending + due). */
export function getDueDispatches(db?: Database): Dispatch[] {
  const _db = db ?? getDatabase();
  const rows = _db
    .query(
      `SELECT * FROM dispatches
       WHERE status = 'pending'
         AND (scheduled_at IS NULL OR scheduled_at <= ?)
       ORDER BY created_at ASC`,
    )
    .all(now()) as DispatchRow[];
  return rows.map(rowToDispatch);
}
