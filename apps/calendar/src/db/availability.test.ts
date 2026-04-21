import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createAvailability, getAvailabilityForAgent, updateAvailability, deleteAvailability, upsertAgentAvailability } from "./availability.js";
import { registerAgent } from "./agents.js";
import { createOrg } from "./orgs.js";
import { getDatabase, resetDatabase } from "./database.js";
import { NotFoundError } from "../types/index.js";

describe("availability", () => {
  let agentId: string;
  let orgId: string;

  beforeEach(() => {
    resetDatabase();
    getDatabase(":memory:");
    const org = createOrg({ name: "Test", slug: "test" });
    orgId = org.id;
    const agent = registerAgent({ name: "agent1" });
    agentId = agent.id;
  });

  afterEach(() => resetDatabase());

  test("create availability", () => {
    const av = createAvailability({
      agent_id: agentId,
      org_id: orgId,
      day_of_week: 1, // Monday
      start_time: "09:00",
      end_time: "17:00",
    });
    expect(av.day_of_week).toBe(1);
    expect(av.start_time).toBe("09:00");
    expect(av.end_time).toBe("17:00");
  });

  test("get availability for agent", () => {
    createAvailability({ agent_id: agentId, org_id: orgId, day_of_week: 0, start_time: "10:00", end_time: "14:00" });
    createAvailability({ agent_id: agentId, org_id: orgId, day_of_week: 1, start_time: "09:00", end_time: "17:00" });
    const avail = getAvailabilityForAgent(agentId);
    expect(avail.length).toBe(2);
  });

  test("update availability", () => {
    const av = createAvailability({ agent_id: agentId, org_id: orgId, day_of_week: 2, start_time: "09:00", end_time: "17:00" });
    const updated = updateAvailability(av.id, { start_time: "08:00", end_time: "18:00" });
    expect(updated.start_time).toBe("08:00");
    expect(updated.end_time).toBe("18:00");
  });

  test("delete availability", () => {
    const av = createAvailability({ agent_id: agentId, org_id: orgId, day_of_week: 3, start_time: "09:00", end_time: "17:00" });
    expect(deleteAvailability(av.id)).toBe(true);
  });

  test("upsert replaces existing for same day", () => {
    createAvailability({ agent_id: agentId, org_id: orgId, day_of_week: 1, start_time: "09:00", end_time: "17:00" });
    upsertAgentAvailability(agentId, orgId, 1, "08:00", "18:00");
    const avail = getAvailabilityForAgent(agentId, orgId);
    expect(avail.length).toBe(1);
    expect(avail[0]!.start_time).toBe("08:00");
  });

  test("exceptions stored as array", () => {
    const av = createAvailability({
      agent_id: agentId,
      org_id: orgId,
      day_of_week: 5,
      start_time: "09:00",
      end_time: "12:00",
      exceptions: ["2026-04-17", "2026-05-01"],
    });
    expect(av.exceptions).toEqual(["2026-04-17", "2026-05-01"]);
  });

  test("update nonexistent throws", () => {
    expect(() => updateAvailability("nope", { start_time: "08:00" })).toThrow(NotFoundError);
  });

  test("get availability filtered by org", () => {
    const org2 = createOrg({ name: "Other", slug: "other" });
    createAvailability({ agent_id: agentId, org_id: orgId, day_of_week: 0, start_time: "09:00", end_time: "17:00" });
    createAvailability({ agent_id: agentId, org_id: org2.id, day_of_week: 0, start_time: "14:00", end_time: "18:00" });
    const avail = getAvailabilityForAgent(agentId, orgId);
    expect(avail.length).toBe(1);
  });
});
