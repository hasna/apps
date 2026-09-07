import { expect, test } from "bun:test";
import {
  runSequenceBatch,
  type SequenceWorkerStore,
} from "./sequence-worker.js";
const row = {
  id: "enrollment-fixture",
  current_step: 0,
  execution_lease: new Date().toISOString(),
};
const snapshot = {
  id: "sequence:enrollment-fixture:0",
  from_address: "sender@example.com",
  to_addresses: ["recipient@example.com"],
  subject: "Fixture",
  text_body: "Body",
  next_delay_hours: 2,
};
function fixture() {
  const finishes: unknown[][] = [];
  return {
    finishes,
    store: {
      claim: async () => [row],
      isCurrent: async () => true,
      prepare: async () => snapshot,
      finish: async (...args: unknown[]) => {
        finishes.push(args);
        return true;
      },
    } as unknown as SequenceWorkerStore,
  };
}
test("sequence durable202 advances exactly once using stable step identity", async () => {
  const f = fixture();
  let payload: Record<string, unknown> | undefined;
  const result = await runSequenceBatch(f.store, async (body) => {
    payload = body;
    return Response.json(
      { sent: true, message: { id: "message", send_state: "sent" } },
      { status: 202 },
    );
  });
  expect(result.sequences.sent).toBe(1);
  expect(result.sequences.pending).toBe(0);
  expect(payload?.idempotency_key).toBe(
    "scheduled:sequence:enrollment-fixture:0",
  );
  expect(f.finishes[0]?.[2]).toBe("sent");
});
test("suppression never advances and uncertain receipts retain the claim", async () => {
  const f = fixture();
  const result = await runSequenceBatch(f.store, async () =>
    Response.json(
      { reason: "recipient_suppressed", sent: false },
      { status: 409 },
    ),
  );
  expect(result.sequences.failed).toBe(1);
  expect(f.finishes[0]?.[2]).toBe("failed");
  const uncertain = fixture();
  const pending = await runSequenceBatch(uncertain.store, async () =>
    Response.json(
      { sent: null, message: { id: "message", send_state: "uncertain" } },
      { status: 502 },
    ),
  );
  expect(pending.sequences.pending).toBe(1);
  expect(uncertain.finishes).toHaveLength(0);
});
test("missing template fails visibly without contacting provider or skipping step", async () => {
  const f = fixture();
  f.store.prepare = async () => {
    throw new Error("Template missing");
  };
  let sends = 0;
  const result = await runSequenceBatch(f.store, async () => {
    sends++;
    throw new Error("Unexpected");
  });
  expect(sends).toBe(0);
  expect(result.sequences.failed).toBe(1);
  expect(f.finishes[0]?.[2]).toBe("failed");
});

test("lost or cancelled claim never reaches the send handler", async()=>{
 const f=fixture();f.store.isCurrent=async()=>false;let sent=false;
 const result=await runSequenceBatch(f.store,async()=>{sent=true;throw new Error("Unexpected send");});
 expect(sent).toBe(false);expect(result.sequences.pending).toBe(1);expect(f.finishes).toHaveLength(0);
});

test("a 200 response cannot advance an unsent or unconfirmed sequence step", async () => {
  for (const body of [
    { sent: false, message: { id: "unsent", send_state: "failed" } },
    { message: { id: "unknown" } },
    { sent: true, message: { id: "unknown" } },
  ]) {
    const f = fixture();
    const result = await runSequenceBatch(f.store, async () => Response.json(body));
    expect(result.sequences.sent).toBe(0);
    if (body.sent === false) {
      expect(result.sequences.failed).toBe(1);
      expect(f.finishes[0]?.[2]).toBe("failed");
    } else {
      expect(result.sequences.pending).toBe(1);
      expect(f.finishes).toHaveLength(0);
    }
  }
});
