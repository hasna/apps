import { describe, expect, test } from "bun:test";
import type { ConfigStore } from "../data/config-store.js";
import type { Config } from "../types/index.js";
import { ensureGlobalAgentRulesStandardConfig } from "./global-agent-rules-standard.js";
import { ensureDangerousOperationGuardStandardConfig } from "./dangerous-operation-guard-standard.js";
import { ensureCodewithSharedTodosStorageStandardConfig } from "./codewith-shared-todos-storage-standard.js";
import { ensureProjectDashboardStandardConfig } from "./project-dashboard-standard.js";

const seeders = [
  ensureGlobalAgentRulesStandardConfig,
  ensureDangerousOperationGuardStandardConfig,
  ensureCodewithSharedTodosStorageStandardConfig,
  ensureProjectDashboardStandardConfig,
];

describe("retired standard sources", () => {
  test("init does not resurrect replaced rules or add them to active profiles", async () => {
    for (const seed of seeders) {
      for (const tag of ["retired-global-source", "retired-instruction-source"]) {
        const existing = { id: "retained-history", tags: [tag], version: 7 } as Config;
        let mutations = 0;
        const store = {
          getConfig: async () => existing,
          createConfig: async () => { mutations++; throw new Error("unexpected creation"); },
          updateConfig: async () => { mutations++; throw new Error("unexpected update"); },
          listProfiles: async () => { mutations++; throw new Error("unexpected profile expansion"); },
        } as unknown as ConfigStore;
        expect(await seed(store)).toBe(existing);
        expect(mutations).toBe(0);
      }
    }
  });

  test("failed hosted reads do not trigger replacement creation", async () => {
    for (const seed of seeders) {
      let creates = 0;
      const store = {
        getConfig: async () => { throw new Error("hosted authentication unavailable"); },
        createConfig: async () => { creates++; throw new Error("unexpected creation"); },
      } as unknown as ConfigStore;
      await expect(seed(store)).rejects.toThrow("hosted authentication unavailable");
      expect(creates).toBe(0);
    }
  });
});
