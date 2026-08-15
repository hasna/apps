import { describe, it, expect } from "bun:test";
import {
  shouldRegisterToolForProfile,
  assertToolAllowed,
  resolveAccessProfile,
  listAccessProfiles,
  getHeadlessUsageNotes,
  READ_ONLY_TOOLS,
  MINIMAL_TOOLS,
} from "./access-profiles.js";

describe("access profiles", () => {
  it("resolves profile aliases", () => {
    expect(resolveAccessProfile("minimal")).toBe("minimal");
    expect(resolveAccessProfile("readonly")).toBe("read_only");
    expect(resolveAccessProfile("unknown")).toBe("full");
  });

  it("read_only allows get but not create", () => {
    expect(shouldRegisterToolForProfile("get_task", "read_only")).toBe(true);
    expect(shouldRegisterToolForProfile("create_task", "read_only")).toBe(false);
  });

  it("agent_safe allows workflow mutations", () => {
    expect(shouldRegisterToolForProfile("complete_task", "agent_safe")).toBe(true);
    expect(shouldRegisterToolForProfile("delete_task", "agent_safe")).toBe(false);
  });

  it("admin allows dangerous tools blocked in other profiles", () => {
    expect(shouldRegisterToolForProfile("delete_task", "full")).toBe(false);
    expect(shouldRegisterToolForProfile("delete_task", "standard")).toBe(false);
    expect(shouldRegisterToolForProfile("migrate_pg", "admin")).toBe(true);
    expect(shouldRegisterToolForProfile("migrate_pg", "full")).toBe(false);
    expect(shouldRegisterToolForProfile("create_task", "full")).toBe(true);
  });

  it("assertToolAllowed throws for blocked tools", () => {
    expect(() => assertToolAllowed("create_task", "read_only")).toThrow(/not available/i);
  });

  it("lists all profile metadata", () => {
    expect(listAccessProfiles().length).toBe(6);
  });

  it("minimal is subset of agent_safe read tools", () => {
    for (const t of MINIMAL_TOOLS) {
      expect(shouldRegisterToolForProfile(t, "agent_safe")).toBe(true);
    }
  });

  it("provides headless usage notes without cloud refs", () => {
    const notes = getHeadlessUsageNotes("agent_safe");
    expect(notes.join(" ")).not.toMatch(/platform-todos|oauth/i);
    expect(notes[0]).toContain("agent_safe");
  });

  it("read_only includes search and status tools", () => {
    expect(READ_ONLY_TOOLS.has("get_status")).toBe(true);
    expect(READ_ONLY_TOOLS.has("search_tasks")).toBe(true);
  });
});
