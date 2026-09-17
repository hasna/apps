import { describe, expect, test } from "bun:test";
import { MEMENTOS_MCP_PROFILE_TOOLS, selectMcpProfile } from "./profile.js";

const hostedAutomationTools = [
  "memory_profile",
  "memory_ingest_session",
  "memory_session_status",
  "memory_session_list",
] as const;

const hostedLockTools = [
  "memory_lock",
  "memory_unlock",
  "memory_check_lock",
] as const;

describe("MCP profile preservation for hosted locks/session/profile", () => {
  test("session and profile tools remain automation-only outside full", () => {
    for (const name of hostedAutomationTools) {
      expect(MEMENTOS_MCP_PROFILE_TOOLS.automation).toContain(name);
      expect(selectMcpProfile("automation").toolNames.has(name)).toBe(true);
      for (const profile of ["core", "search", "graph", "admin", "storage", "hooks"] as const) {
        expect(selectMcpProfile(profile).toolNames.has(name)).toBe(false);
      }
      expect(selectMcpProfile("full").full).toBe(true);
    }
  });

  test("memory lock tools remain admin-only outside full", () => {
    for (const name of hostedLockTools) {
      expect(MEMENTOS_MCP_PROFILE_TOOLS.admin).toContain(name);
      expect(selectMcpProfile("admin").toolNames.has(name)).toBe(true);
      for (const profile of ["core", "search", "graph", "automation", "storage", "hooks"] as const) {
        expect(selectMcpProfile(profile).toolNames.has(name)).toBe(false);
      }
      expect(selectMcpProfile("full").full).toBe(true);
    }
  });
});
