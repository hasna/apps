import { getDatabase, now, uuid } from "../db/database.ts";
import { getEmailProvider } from "./index.ts";
import type { SendEmailOptions } from "./interface.ts";

export interface EnqueueOptions extends SendEmailOptions {
  send_at?: string; // ISO timestamp for delayed send
}

export function enqueue(options: EnqueueOptions): string {
  const database = getDatabase();
  const id = uuid();
  const n = now();

  database.run(
    `INSERT INTO email_queue
       (id, provider, to_addresses, from_address, subject, html, text, headers, status, attempts, send_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [
      id,
      process.env["EMAIL_PROVIDER"] ?? "console",
      JSON.stringify(options.to),
      options.from,
      options.subject,
      options.html ?? null,
      options.text ?? null,
      JSON.stringify(options.headers ?? {}),
      options.send_at ?? null,
      n,
    ]
  );

  return id;
}

const MAX_ATTEMPTS = 3;

export async function processQueue(): Promise<{ sent: number; failed: number }> {
  const database = getDatabase();
  const now_iso = now();

  interface QueueRow {
    id: string; to_addresses: string; from_address: string; subject: string;
    html: string | null; text: string | null; headers: string; attempts: number;
  }

  const pending = database.query<QueueRow, [string]>(
    `SELECT * FROM email_queue
     WHERE status = 'pending' AND (send_at IS NULL OR send_at <= ?)
     ORDER BY created_at ASC LIMIT 50`
  ).all(now_iso);

  const provider = getEmailProvider();
  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      await provider.send({
        from: row.from_address,
        to: JSON.parse(row.to_addresses) as string[],
        subject: row.subject,
        html: row.html ?? undefined,
        text: row.text ?? undefined,
        headers: JSON.parse(row.headers) as Record<string, string>,
      });

      database.run(
        "UPDATE email_queue SET status = 'sent', sent_at = ?, attempts = attempts + 1 WHERE id = ?",
        [now(), row.id]
      );
      sent++;
    } catch (err) {
      const newAttempts = row.attempts + 1;
      const status = newAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
      const backoffMs = 1000 * Math.pow(2, newAttempts);
      const retryAt = new Date(Date.now() + backoffMs).toISOString();

      database.run(
        `UPDATE email_queue SET attempts = ?, status = ?, last_error = ?, send_at = ? WHERE id = ?`,
        [newAttempts, status, err instanceof Error ? err.message : String(err), status === "pending" ? retryAt : null, row.id]
      );
      if (status === "failed") failed++;
    }
  }

  return { sent, failed };
}

export function getQueueStats(): { pending: number; sent: number; failed: number } {
  const database = getDatabase();
  interface Row { status: string; count: number }
  const rows = database.query<Row, []>("SELECT status, COUNT(*) as count FROM email_queue GROUP BY status").all();
  const stats: Record<string, number> = {};
  for (const r of rows) stats[r.status] = r.count;
  return { pending: stats["pending"] ?? 0, sent: stats["sent"] ?? 0, failed: stats["failed"] ?? 0 };
}
