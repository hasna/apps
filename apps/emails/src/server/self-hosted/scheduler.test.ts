import { expect, test } from "bun:test";
import { runScheduledBatch } from "./scheduler.js";
const job = {
  id: "schedule-1",
  from_address: "sender@example.com",
  to_addresses: ["recipient@example.com"],
  subject: "Fixture",
  text_body: "Body",
  status: "processing",
  updated_at: "2026-09-07T00:00:00.000Z",
};
test("scheduler sends through shared API callback with stable identity and records receipt", async () => {
  const finished: any[] = [];
  let payload: any;
  const result = await runScheduledBatch(
    {
      claimDueScheduled: async () => [job],
      finishScheduled: async (...args: any[]) => {
        finished.push(args);
        return true;
      },
      getScheduledTemplate: async () => null,
    },
    async (input) => {
      payload = input;
      return new Response(
        JSON.stringify({ message: { id: "sent-fixture", send_state: "sent" }, sent: true }),
        { status: 200 },
      );
    },
    1,
  );
  expect(payload.idempotency_key).toBe("scheduled:schedule-1");
  expect(result.scheduled.sent).toBe(1);
  expect(finished[0][2]).toBe("sent");
});
test("pending and uncertain send outcomes never become sent or replay with fresh keys", async () => {
  const finished: any[] = [];
  const result = await runScheduledBatch(
    {
      claimDueScheduled: async () => [job],
      finishScheduled: async (...args: any[]) => {
        finished.push(args);
        return true;
      },
      getScheduledTemplate: async () => null,
    },
    async () =>
      new Response(JSON.stringify({ in_progress: true }), { status: 202 }),
    1,
  );
  expect(result.scheduled.sent).toBe(0);
  expect(result.scheduled.pending).toBe(1);
  expect(finished).toHaveLength(0);
});
test("provider errors become failed jobs and do not prevent subsequent jobs", async () => {
  const finished: any[] = [];
  let calls = 0;
  const result = await runScheduledBatch(
    {
      claimDueScheduled: async () => [job, { ...job, id: "schedule-2" }],
      finishScheduled: async (...args: any[]) => {
        finished.push(args);
        return true;
      },
      getScheduledTemplate: async () => null,
    },
    async () => {
      calls++;
      return new Response(
        JSON.stringify(
          calls === 1
            ? { error: "suppressed", reason: "recipient_suppressed" }
            : { message: { id: "sent-2", send_state: "sent" }, sent: true },
        ),
        { status: calls === 1 ? 403 : 200 },
      );
    },
    2,
  );
  expect(result.scheduled).toMatchObject({ attempted: 2, sent: 1, failed: 1 });
  expect(finished.map((x) => x[2])).toEqual(["failed", "sent"]);
});
test("invalid queued payload fails without contacting a provider", async () => {
  let sends = 0;
  const finished: any[] = [];
  const result = await runScheduledBatch(
    {
      claimDueScheduled: async () => [{ ...job, to_addresses: [] }],
      finishScheduled: async (...args: any[]) => {
        finished.push(args);
        return true;
      },
      getScheduledTemplate: async () => null,
    },
    async () => {
      sends++;
      return new Response();
    },
    1,
  );
  expect(sends).toBe(0);
  expect(result.scheduled.failed).toBe(1);
  expect(finished[0][2]).toBe("failed");
});
test("lost transport acknowledgement reuses identical send identity on recovery", async () => {
  const keys: string[] = [];
  let calls = 0;
  const store = {
    claimDueScheduled: async () => [job],
    finishScheduled: async () => true,
    getScheduledTemplate: async () => null,
  };
  const send = async (body: Record<string, unknown>) => {
    keys.push(String(body.idempotency_key));
    calls++;
    if (calls === 1) throw new Error("Acknowledgement lost");
    return new Response(JSON.stringify({ message: { id: "existing-sent", send_state: "sent" }, sent: true }));
  };
  expect((await runScheduledBatch(store, send, 1)).scheduled.pending).toBe(1);
  expect((await runScheduledBatch(store, send, 1)).scheduled.sent).toBe(1);
  expect(keys[0]).toBe(keys[1]);
});

test("uncertain and finalization-warning receipts remain recoverable without claiming sent", async () => {
  for (const [status, body] of [
    [
      202,
      {
        sent: true,
        warning: "reconcile",
        message: { id: "fixture", send_state: "uncertain" },
      },
    ],
    [
      502,
      {
        sent: null,
        reconciliation_required: true,
        message: { id: "fixture", send_state: "uncertain" },
      },
    ],
    [409, { message: { id: "fixture", send_state: "uncertain" } }],
  ] as const) {
    let finished = false;
    const result = await runScheduledBatch(
      {
        claimDueScheduled: async () => [job],
        getScheduledTemplate: async () => null,
        finishScheduled: async () => {
          finished = true;
          return true;
        },
      },
      async () => new Response(JSON.stringify(body), { status }),
    );
    expect(result.scheduled.pending).toBe(1);
    expect(result.scheduled.sent).toBe(0);
    expect(finished).toBe(false);
  }
});
