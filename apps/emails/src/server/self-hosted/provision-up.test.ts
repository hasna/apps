import { expect, test } from "bun:test";
import {
  normalizeProvisionUp,
  newProvisionUpReceipt,
  advanceProvisionUp,
  type ProvisionUpJob,
  type ProvisionUpDeps,
} from "./provision-up.js";

function fixture(testCount = 1) {
  let job: ProvisionUpJob = {
    id: "fixture-run",
    input_hash: "fixture",
    input: {
      ...normalizeProvisionUp({
        domain: "example.test",
        provider_id: "provider",
        addresses: "one,two",
        count: testCount,
      }),
      provider_type: "ses",
      provider_region: "eu-west-1",
      dns_binding: {
        tenant_id: "tenant",
        provider_id: "provider",
        domain: "example.test",
        zone_id: "a".repeat(32),
        zone_name: "example.test",
        token_env: "FIXTURE_DNS_TOKEN",
      },
    },
    status: "pending",
    lease: null,
    receipt: null,
    created_at: "fixture",
    updated_at: "fixture",
  };
  job.receipt = newProvisionUpReceipt(job.input, job.id);
  const calls: string[] = [],
    saved: ProvisionUpJob[] = [];
  let now = 100000;
  const deps: ProvisionUpDeps = {
    now: () => now,
    store: {
      claim: async () => {
        if (
          job.status === "blocked" ||
          job.status === "ready" ||
          job.receipt!.next_attempt_ms > now
        )
          return null;
        job = { ...job, status: "processing", lease: crypto.randomUUID() };
        return structuredClone(job);
      },
      get: async () => structuredClone(job),
      assertCurrent: async (claim) => {
        if (job.lease !== claim.lease) throw new Error("lease lost");
      },
      save: async (claim, receipt, status) => {
        if (job.lease !== claim.lease) throw new Error("lease lost");
        job = {
          ...job,
          receipt: structuredClone(receipt),
          status,
          lease: status === "processing" ? job.lease : null,
        };
        saved.push(structuredClone(job));
        return structuredClone(job);
      },
    },
    dns: async () => {
      calls.push("dns");
      return {
        dry_run: false,
        job: {
          id: "dns-child",
          domain: "example.test",
          provider_id: "provider",
          zone_id: "zone",
          status: "verified",
          phase: "complete",
          dns_published: true,
          verified_for_sending: true,
          requires_reconciliation: false,
          plan: null,
          message: "Verified",
        },
      };
    },
    address: async (_input, email, key) => {
      calls.push("address:" + email);
      return {
        id: key,
        status: "ready",
        receipt: {
          ready: true,
          code: "ready",
          message: "Verified",
          checked_at: "fixture",
        },
      };
    },
    send: async (item) => {
      calls.push("send:" + item.send_key);
      return Response.json(
        {
          sent: true,
          provider_message_id: "provider-message",
          message: { id: item.send_key, send_state: "sent" },
        },
        { status: 202 },
      );
    },
    read: async (item) => {
      calls.push("read:" + item.to);
      return [
        {
          id: "inbound:" + item.to,
          from_address: item.from,
          subject: item.subject,
          text_body: item.token,
          html_body: null,
          received_at: "fixture",
        },
      ];
    },
  };
  return {
    deps,
    calls,
    saved,
    job: () => job,
    tick: async () => {
      now += 30000;
      return advanceProvisionUp(job.id, deps);
    },
    retry: () => {
      job = {
        ...job,
        status: "pending",
        lease: null,
        receipt: {
          ...job.receipt!,
          phase: "dns",
          address_cursor: 0,
          next_attempt_ms: 0,
        },
      };
    },
  };
}

test("normalization preserves MX unless explicitly requested and rejects purchase selectors before work", () => {
  expect(
    normalizeProvisionUp({ domain: "Example.Test", provider_id: "provider" }),
  ).toMatchObject({
    domain: "example.test",
    add_mx: false,
    force_mx_switch: false,
    addresses: ["one", "two", "three"],
    test_count: 1,
  });
  for (const change of [
    { buy_if_needed: true },
    { purchase_profile: "ambient" },
    { count: -1 },
    { count: 101 },
    { addresses: "one,one" },
    { force_mx_switch: true },
    { provider_id: "" },
  ])
    expect(() =>
      normalizeProvisionUp({
        domain: "example.test",
        provider_id: "provider",
        ...change,
      }),
    ).toThrow();
});
test("checkpoints every send before and after acceptance and completes only exact receipts", async () => {
  const f = fixture();
  for (let tick = 0; tick < 20 && f.job().status !== "ready"; tick++)
    await f.tick();
  expect(f.job().status).toBe("ready");
  expect(f.job().receipt).toMatchObject({
    complete: true,
    delivery_tested: true,
  });
  expect(f.calls.filter((call) => call.startsWith("send:"))).toHaveLength(2);
  for (const item of f.job().receipt!.roundtrip.items) {
    expect(item.state).toBe("received");
    expect(
      f.saved.some((saved) =>
        saved.receipt!.roundtrip.items.some(
          (row) => row.send_key === item.send_key && row.state === "uncertain",
        ),
      ),
    ).toBe(true);
    expect(
      f.saved.some((saved) =>
        saved.receipt!.roundtrip.items.some(
          (row) => row.send_key === item.send_key && row.state === "sent",
        ),
      ),
    ).toBe(true);
  }
});
test("uncertain sends halt later work and retry retains the identical send identity", async () => {
  const f = fixture();
  const accepted: string[] = [];
  f.deps.send = async (item) => {
    accepted.push(item.send_key);
    return Response.json(
      { in_progress: true, message: { id: "intent", send_state: "uncertain" } },
      { status: 202 },
    );
  };
  for (let tick = 0; tick < 10 && f.job().status !== "blocked"; tick++)
    await f.tick();
  expect(f.job().status).toBe("blocked");
  expect(accepted).toHaveLength(1);
  expect(f.job().receipt!.roundtrip.items[1]!.state).toBe("not_attempted");
  f.retry();
  for (let tick = 0; tick < 10 && f.job().status !== "blocked"; tick++)
    await f.tick();
  expect(accepted).toEqual([accepted[0]!, accepted[0]!]);
});
test("explicitly skipped delivery tests send nothing and retain that distinction", async () => {
  const f = fixture(0);
  for (let tick = 0; tick < 10 && f.job().status !== "ready"; tick++)
    await f.tick();
  expect(f.job().receipt).toMatchObject({
    complete: true,
    delivery_tested: false,
  });
  expect(f.calls.some((call) => call.startsWith("send:"))).toBe(false);
});
test("wrong sender or token cannot count as a received probe", async () => {
  const f = fixture();
  f.deps.read = async (item) => [
    {
      id: "wrong",
      from_address: item.from,
      subject: item.subject,
      text_body: item.token + "suffix",
      received_at: "fixture",
    },
  ];
  for (let i = 0; i < 20; i++) await f.tick();
  expect(f.job().status).toBe("pending");
  expect(
    f.job().receipt!.roundtrip.items.every((item) => item.state === "sent"),
  ).toBe(true);
});
test("binding changes fence the next send and raw provider errors never enter receipts", async () => {
  const f = fixture();
  f.deps.guard = async () => {
    if (f.job().receipt!.phase === "roundtrip")
      throw new Error("secret-provider-value");
  };
  for (let i = 0; i < 10 && f.job().status !== "blocked"; i++) await f.tick();
  expect(f.job().status).toBe("blocked");
  expect(f.calls.some((call) => call.startsWith("send:"))).toBe(false);
  expect(JSON.stringify(f.job().receipt)).not.toContain(
    "secret-provider-value",
  );
});
