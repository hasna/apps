import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  assignmentService,
  capabilityService,
  exportService,
  lifecycleService,
  memberService,
} from "../src/services/index.js";
import { InvalidLifecycleTransitionError, MemberNotFoundError, ValidationError } from "../src/types/index.js";
import { cleanupTestDatabase, testEntity, useTestDatabase } from "./helpers/database.js";

let dbPath: string;
let entity: string;

beforeEach(() => {
  dbPath = useTestDatabase("domain");
  entity = testEntity();
});
afterEach(() => cleanupTestDatabase(dbPath));

describe("members", () => {
  it("onboards a human and records a hire lifecycle event", () => {
    const member = memberService.createMember({ kind: "human", name: "Ada", home_entity_id: entity, role: "Engineer" });
    expect(member.kind).toBe("human");
    expect(member.status).toBe("active");
    const events = lifecycleService.listMemberLifecycle(member.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("hire");
  });

  it("rejects an agent without an owning human", () => {
    expect(() => memberService.createMember({ kind: "agent", name: "Bot", home_entity_id: entity })).toThrow(ValidationError);
  });

  it("accepts an agent with an owning human (agents are first-class members)", () => {
    const owner = memberService.createMember({ kind: "human", name: "Owner", home_entity_id: entity });
    const agent = memberService.createMember({ kind: "agent", name: "Bot", home_entity_id: entity, owner_id: owner.id });
    expect(agent.owner_id).toBe(owner.id);
  });

  it("rejects a non-UUID home_entity_id", () => {
    expect(() => memberService.createMember({ kind: "human", name: "X", home_entity_id: "acme" })).toThrow(ValidationError);
  });

  it("bumps version on update", () => {
    const member = memberService.createMember({ kind: "contractor", name: "C", home_entity_id: entity });
    const updated = memberService.updateMember(member.id, { role: "Advisor" });
    expect(updated.role).toBe("Advisor");
    expect(updated.version).toBe(2);
  });
});

describe("lifecycle (joiner-mover-leaver)", () => {
  it("records a role change with from/to roles", () => {
    const m = memberService.createMember({ kind: "human", name: "M", home_entity_id: entity, role: "Junior" });
    const { event } = lifecycleService.recordRoleChange({ member_id: m.id, to_role: "Senior" });
    expect(event.from_role).toBe("Junior");
    expect(event.to_role).toBe("Senior");
    expect(memberService.getMember(m.id).role).toBe("Senior");
  });

  it("enforces valid status transitions", () => {
    const m = memberService.createMember({ kind: "human", name: "M", home_entity_id: entity });
    lifecycleService.suspendMember({ member_id: m.id });
    expect(memberService.getMember(m.id).status).toBe("suspended");
    lifecycleService.reactivateMember({ member_id: m.id });
    expect(memberService.getMember(m.id).status).toBe("active");
    lifecycleService.offboardMember({ member_id: m.id });
    expect(memberService.getMember(m.id).status).toBe("offboarded");
    expect(() => lifecycleService.suspendMember({ member_id: m.id })).toThrow(InvalidLifecycleTransitionError);
  });

  it("verifies the audit chain across many events", () => {
    const m = memberService.createMember({ kind: "human", name: "M", home_entity_id: entity });
    lifecycleService.recordRoleChange({ member_id: m.id, to_role: "A" });
    lifecycleService.recordRoleChange({ member_id: m.id, to_role: "B" });
    const result = lifecycleService.verifyLifecycleAudit();
    expect(result.valid).toBe(true);
    expect(result.checked).toBeGreaterThanOrEqual(3);
  });
});

describe("capabilities", () => {
  it("adds and lists capabilities for a member", () => {
    const m = memberService.createMember({ kind: "agent", name: "Bot", home_entity_id: entity, owner_id: memberService.createMember({ kind: "human", name: "O", home_entity_id: entity }).id });
    capabilityService.addCapability({ member_id: m.id, name: "web-search", level: "expert", category: "tools" });
    const caps = capabilityService.listCapabilities(m.id);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.level).toBe("expert");
  });

  it("throws for capabilities on a missing member", () => {
    expect(() => capabilityService.addCapability({ member_id: "nope", name: "x" })).toThrow(MemberNotFoundError);
  });
});

describe("assignments", () => {
  it("assigns a member to an entity/project and ends it", () => {
    const m = memberService.createMember({ kind: "human", name: "M", home_entity_id: entity });
    const projectEntity = testEntity();
    const a = assignmentService.createAssignment({ member_id: m.id, entity_id: projectEntity, project: "Apollo", allocation_pct: 50 });
    expect(a.status).toBe("active");
    const ended = assignmentService.endAssignment(a.id);
    expect(ended.status).toBe("ended");
    expect(ended.end_date).not.toBeNull();
  });

  it("rejects allocation outside 0..100", () => {
    const m = memberService.createMember({ kind: "human", name: "M", home_entity_id: entity });
    expect(() => assignmentService.createAssignment({ member_id: m.id, entity_id: testEntity(), allocation_pct: 150 })).toThrow(ValidationError);
  });
});

describe("roster export contract (payroll/timesheets)", () => {
  it("produces normalized payroll classes and active assignments", () => {
    const human = memberService.createMember({ kind: "human", name: "H", home_entity_id: entity, role: "Eng" });
    const agent = memberService.createMember({ kind: "agent", name: "A", home_entity_id: entity, owner_id: human.id });
    capabilityService.addCapability({ member_id: agent.id, name: "codegen" });
    assignmentService.createAssignment({ member_id: agent.id, entity_id: entity, project: "X" });
    const roster = exportService.exportRoster({ entity_id: entity });
    expect(roster.schema).toBe("hasna.workforce.roster_export.v1");
    expect(roster.member_count).toBe(2);
    const agentRow = roster.members.find((m) => m.member_id === agent.id)!;
    expect(agentRow.payroll_class).toBe("agent");
    expect(agentRow.capabilities).toContain("codegen");
    expect(agentRow.active_assignments).toHaveLength(1);
    const humanRow = roster.members.find((m) => m.member_id === human.id)!;
    expect(humanRow.payroll_class).toBe("employee");
  });

  it("excludes offboarded members by default", () => {
    const m = memberService.createMember({ kind: "human", name: "Leaver", home_entity_id: entity });
    lifecycleService.offboardMember({ member_id: m.id });
    expect(exportService.exportRoster({ entity_id: entity }).member_count).toBe(0);
    expect(exportService.exportRoster({ entity_id: entity, include_offboarded: true }).member_count).toBe(1);
  });
});
