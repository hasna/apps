import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMembership, getMembership, getMembershipsForOrg, getOrgsForAgent, updateMembershipRole, deleteMembershipByAgentAndOrg } from "./memberships.js";
import { registerAgent } from "./agents.js";
import { createOrg } from "./orgs.js";
import { getDatabase, resetDatabase } from "./database.js";
import { NotFoundError, ConflictError } from "../types/index.js";

describe("memberships", () => {
  let orgId: string;
  let agentId: string;

  beforeEach(() => {
    resetDatabase();
    getDatabase(":memory:");
    const org = createOrg({ name: "Test", slug: "test" });
    orgId = org.id;
    const agent = registerAgent({ name: "agent1" });
    agentId = agent.id;
  });

  afterEach(() => resetDatabase());

  test("create membership", () => {
    const m = createMembership({ org_id: orgId, agent_id: agentId });
    expect(m.org_id).toBe(orgId);
    expect(m.agent_id).toBe(agentId);
    expect(m.role).toBe("member");
  });

  test("create membership with role", () => {
    const m = createMembership({ org_id: orgId, agent_id: agentId, role: "admin" });
    expect(m.role).toBe("admin");
  });

  test("duplicate membership throws", () => {
    createMembership({ org_id: orgId, agent_id: agentId });
    expect(() => createMembership({ org_id: orgId, agent_id: agentId })).toThrow(ConflictError);
  });

  test("get memberships for org", () => {
    const a2 = registerAgent({ name: "agent2" });
    createMembership({ org_id: orgId, agent_id: agentId });
    createMembership({ org_id: orgId, agent_id: a2.id });
    const members = getMembershipsForOrg(orgId);
    expect(members.length).toBe(2);
  });

  test("get orgs for agent", () => {
    const org2 = createOrg({ name: "Other", slug: "other" });
    createMembership({ org_id: orgId, agent_id: agentId });
    createMembership({ org_id: org2.id, agent_id: agentId, role: "service" });
    const orgs = getOrgsForAgent(agentId);
    expect(orgs.length).toBe(2);
  });

  test("update role", () => {
    const m = createMembership({ org_id: orgId, agent_id: agentId });
    const updated = updateMembershipRole(m.id, "admin");
    expect(updated.role).toBe("admin");
  });

  test("delete membership", () => {
    const m = createMembership({ org_id: orgId, agent_id: agentId });
    expect(deleteMembershipByAgentAndOrg(agentId, orgId)).toBe(true);
  });

  test("update nonexistent throws", () => {
    expect(() => updateMembershipRole("nope", "admin")).toThrow(NotFoundError);
  });
});
