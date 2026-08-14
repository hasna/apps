import { describe, expect, it } from "bun:test";
import {
  normalizePriorityAddress,
  normalizePriorityDomain,
  normalizePriorityRuleInput,
  priorityRuleMatchesSender,
  prioritySenderRuleId,
} from "./priority-senders.js";

describe("priority sender rules", () => {
  it("normalizes addresses and domains to canonical case-folded values", () => {
    expect(normalizePriorityAddress(" Priority Person <Person@Example.COM> ")).toBe("person@example.com");
    expect(normalizePriorityDomain(" @Example.COM. ")).toBe("example.com");
    expect(normalizePriorityRuleInput(" ADDRESS ", "Person@Example.COM")).toEqual({
      kind: "address",
      value: "person@example.com",
    });
  });

  it("uses deterministic ids and matches exact addresses or complete domains", () => {
    const rules = [
      { id: prioritySenderRuleId("address", "person@example.com"), kind: "address" as const, value: "person@example.com" },
      { id: prioritySenderRuleId("domain", "example.com"), kind: "domain" as const, value: "example.com" },
    ];
    expect(priorityRuleMatchesSender("PERSON@EXAMPLE.COM", rules)).toBe(true);
    expect(priorityRuleMatchesSender("other@example.com", rules)).toBe(true);
    expect(priorityRuleMatchesSender("other@example.com.evil", rules)).toBe(false);
    expect(prioritySenderRuleId("address", "person@example.com")).toBe("priority:address:person@example.com");
  });

  it("rejects malformed values and does not broaden domain rules", () => {
    expect(() => normalizePriorityAddress("not-an-address")).toThrow(RangeError);
    expect(() => normalizePriorityDomain("localhost")).toThrow(RangeError);
    expect(() => normalizePriorityDomain("example.com/path")).toThrow(RangeError);
    expect(priorityRuleMatchesSender("display <person@example.com>", [
      { id: "x", kind: "domain", value: "example.com" },
    ])).toBe(true);
  });
});
