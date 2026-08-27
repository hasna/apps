import { describe, expect, it } from "bun:test";
import {
  createDnsPlan,
  getDnsApplyBlockReason,
  normalizeDnsRecord,
  parseDesiredDnsState,
  planHasChanges,
} from "./dns-plan.js";

describe("dns desired-state planning", () => {
  it("normalizes provider FQDN names to domain-relative names", () => {
    expect(normalizeDnsRecord({
      type: "a",
      name: "www.example.com.",
      value: "192.0.2.10",
      ttl: 60,
    }, "example.com")).toEqual({
      type: "A",
      name: "www",
      value: "192.0.2.10",
      ttl: 60,
      priority: undefined,
    });
  });

  it("parses JSON desired state", () => {
    const state = parseDesiredDnsState(JSON.stringify({
      domain: "example.com",
      records: [{ type: "A", name: "@", value: "192.0.2.10", ttl: 600, proxied: true }],
    }));
    expect(state).toEqual({
      domain: "example.com",
      records: [{ type: "A", name: "@", value: "192.0.2.10", ttl: 600, priority: undefined, proxied: true }],
    });
  });

  it("detects proxied drift while treating omitted proxied as provider-agnostic", () => {
    const current = [{ type: "A", name: "@", value: "192.0.2.10", ttl: 300, proxied: false }];
    expect(createDnsPlan("example.com", current, [
      { type: "A", name: "@", value: "192.0.2.10", ttl: 300, proxied: true },
    ]).updates).toBe(1);
    expect(createDnsPlan("example.com", [
      { type: "A", name: "@", value: "192.0.2.10", ttl: 300, proxied: true },
    ], [
      { type: "A", name: "@", value: "192.0.2.10", ttl: 300 },
    ]).unchanged).toBe(1);
  });

  it("classifies proxy-state create, update, and unchanged records during post-apply verification", () => {
    const desired = [
      { type: "A", name: "new", value: "192.0.2.20", ttl: 300, proxied: true },
      { type: "CNAME", name: "preview", value: "origin.example.com", ttl: 300, proxied: true },
      { type: "CNAME", name: "direct", value: "origin.example.com", ttl: 300, proxied: false },
    ];
    const beforeApply = [
      { ...desired[1]!, proxied: false },
      desired[2]!,
    ];

    const plan = createDnsPlan("example.com", beforeApply, desired);
    expect(plan).toMatchObject({ creates: 1, updates: 1, deletes: 0, unchanged: 1 });
    expect(plan.operations).toMatchObject([
      { op: "create", record: { name: "new", proxied: true } },
      { op: "update", record: { name: "preview", proxied: true }, current: { proxied: false } },
      { op: "unchanged", record: { name: "direct", proxied: false }, current: { proxied: false } },
    ]);

    const wrongProxyState = [desired[0]!, { ...desired[1]!, proxied: false }, desired[2]!];
    const failedVerification = createDnsPlan("example.com", wrongProxyState, desired);
    expect(failedVerification).toMatchObject({ creates: 0, updates: 1, deletes: 0, unchanged: 2 });
    expect(failedVerification.operations.find((operation) => operation.op === "update")).toMatchObject({
      record: { name: "preview", proxied: true },
      current: { name: "preview", proxied: false },
    });

    expect(createDnsPlan("example.com", desired, desired)).toMatchObject({
      creates: 0,
      updates: 0,
      deletes: 0,
      unchanged: 3,
    });
  });

  it("creates create/update/delete/unchanged operations", () => {
    const plan = createDnsPlan("example.com", [
      { type: "A", name: "@", value: "192.0.2.1", ttl: 300 },
      { type: "TXT", name: "@", value: "old", ttl: 300 },
      { type: "CNAME", name: "keep", value: "target.example.com", ttl: 300 },
    ], [
      { type: "A", name: "example.com.", value: "192.0.2.1", ttl: 600 },
      { type: "MX", name: "@", value: "mail.example.com", ttl: 300, priority: 10 },
      { type: "CNAME", name: "keep.example.com.", value: "target.example.com", ttl: 300 },
    ]);

    expect(plan).toMatchObject({ creates: 1, updates: 1, deletes: 1, unchanged: 1 });
    expect(plan.operations.map((op) => op.op).sort()).toEqual(["create", "delete", "unchanged", "update"]);
    expect(planHasChanges(plan)).toBe(true);
  });

  it("blocks unconfirmed apply and refuses delete plans the provider cannot express", () => {
    const createOnly = createDnsPlan("example.com", [], [
      { type: "A", name: "@", value: "192.0.2.1", ttl: 300 },
    ]);
    expect(getDnsApplyBlockReason(createOnly, {})).toBe("confirmation-required");
    expect(getDnsApplyBlockReason(createOnly, { yes: true })).toBeUndefined();

    const deletePlan = createDnsPlan("example.com", [
      { type: "TXT", name: "@", value: "old", ttl: 300 },
    ], []);
    expect(getDnsApplyBlockReason(deletePlan, { yes: true })).toBe("delete-confirmation-required");
    expect(getDnsApplyBlockReason(deletePlan, { yes: true, allowDelete: true })).toBe("delete-apply-unsupported");
    // Regression (PLA23-00589): the delete gate is the provider's CAPABILITY (a live
    // delete route), not the delete plan itself — a provider that can converge on
    // deletes must not be refused once the user passed --yes --allow-delete.
    expect(getDnsApplyBlockReason(deletePlan, { yes: true, allowDelete: true }, true)).toBeUndefined();
  });
});
