import { LocalConfigStore } from "./data/config-store";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDatabase, resetDatabase } from "./db/database";
import { createConfig } from "./db/configs";
import { createProfile, addConfigToProfile } from "./db/profiles";
import { registerMachine } from "./db/machines";
import { getConfigsStatus } from "./status";
import type { ConfigAgent } from "./types";
import { tempRootPath } from "./lib/test-temp-root";

let tempDir = "";
let savedApiUrl: string | undefined;
let savedApiKey: string | undefined;

beforeEach(() => {
  savedApiUrl = process.env["HASNA_INSTRUCTIONS_API_URL"];
  savedApiKey = process.env["HASNA_INSTRUCTIONS_API_KEY"];
  delete process.env["HASNA_INSTRUCTIONS_API_URL"];
  delete process.env["HASNA_INSTRUCTIONS_API_KEY"];
  resetDatabase();
  delete process.env["HASNA_INSTRUCTIONS_API_URL"];
  delete process.env["HASNA_INSTRUCTIONS_API_KEY"];
  process.env["HASNA_INSTRUCTIONS_DB_PATH"] = ":memory:";
  tempDir = tempRootPath(`configs-status-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  resetDatabase();
  delete process.env["HASNA_INSTRUCTIONS_API_URL"];
  delete process.env["HASNA_INSTRUCTIONS_API_KEY"];
  delete process.env["HASNA_INSTRUCTIONS_DB_PATH"];
  if (savedApiUrl !== undefined) process.env["HASNA_INSTRUCTIONS_API_URL"] = savedApiUrl;
  else delete process.env["HASNA_INSTRUCTIONS_API_URL"];
  if (savedApiKey !== undefined) process.env["HASNA_INSTRUCTIONS_API_KEY"] = savedApiKey;
  else delete process.env["HASNA_INSTRUCTIONS_API_KEY"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("getConfigsStatus", () => {
  test("reports metadata-only counts without config values, paths, or hostnames", async () => {
    const db = getDatabase();
    const privateTarget = join(tempDir, "private-host.internal", "agent.conf");
    mkdirSync(join(tempDir, "private-host.internal"), { recursive: true });
    writeFileSync(privateTarget, "OPENAI_API_KEY=sk-private-disk-token\n");

    const config = createConfig({
      name: "Private Agent Config",
      kind: "file",
      category: "agent",
      agent: "codex",
      target_path: privateTarget,
      format: "text",
      content: "OPENAI_API_KEY=sk-private-stored-token\n",
      is_template: true,
    }, db);
    const reference = createConfig({
      name: "Synthetic Reference",
      kind: "reference",
      category: "rules",
      agent: "global",
      format: "markdown",
      content: "do not include raw reference text",
    }, db);
    const profile = createProfile({ name: "Synthetic Profile" }, db);
    addConfigToProfile(profile.id, config.id, db);
    registerMachine("private-host.internal", "Linux", "x64", db);

    const status = await getConfigsStatus(new LocalConfigStore(db), { homeDir: tempDir });
    const serialized = JSON.stringify(status);

    const { name, version } = JSON.parse(readFileSync("package.json", "utf-8")) as { name: string; version: string };

    expect(status).toMatchObject({
      service: "configs",
      schemaVersion: "1.0",
      package: { name, version },
      counts: {
        configs: {
          total: 2,
          file: 1,
          reference: 1,
          templates: 1,
          retiredAgentRows: 0,
        },
        profiles: 1,
        profileLinks: 1,
        machines: 1,
        knownTargets: 1,
        managedSkillRuntimes: {
          skillsPresent: 0,
          healthy: 0,
          missing: 0,
        },
      },
      health: {
        status: "warn",
        driftedTargets: 1,
        retiredAgentRows: 0,
        missingManagedSkillRuntimes: 0,
      },
      safety: {
        includesConfigValues: false,
        includesPrivatePaths: false,
        includesHostnames: false,
        includesSecretValues: false,
        statusOutputIsMetadataOnly: true,
      },
    });
    expect(status.counts.byCategory.agent).toBe(1);
    expect(status.counts.byCategory.rules).toBe(1);
    expect(status.counts.byAgent.codex).toBe(1);
    expect(status.counts.byAgent.global).toBe(1);
    expect(serialized).not.toContain(privateTarget);
    expect(serialized).not.toContain(tempDir);
    expect(serialized).not.toContain("private-host.internal");
    expect(serialized).not.toContain("sk-private-stored-token");
    expect(serialized).not.toContain("sk-private-disk-token");
    expect(serialized).not.toContain(reference.content);
  });

  test("surfaces retired agent rows as metadata-only status", async () => {
    const db = getDatabase();
    createConfig({
      name: "Stale Gemini Global Rules",
      kind: "file",
      category: "rules",
      agent: "gemini" as ConfigAgent,
      target_path: "~/.gemini/GEMINI.md",
      format: "markdown",
      content: "stale retired content",
    }, db);

    const status = await getConfigsStatus(new LocalConfigStore(db), { homeDir: tempDir });
    const serialized = JSON.stringify(status);

    expect(status.counts.configs.retiredAgentRows).toBe(1);
    expect(status.health.retiredAgentRows).toBe(1);
    expect(status.health.hasRetiredAgentRows).toBe(true);
    expect(status.health.hasMissingManagedSkillRuntimes).toBe(false);
    expect(status.health.status).toBe("warn");
    expect(status.health.missingTargets).toBe(0);
    expect(status.counts.knownTargets).toBe(0);
    expect(status.counts.byAgent.gemini).toBe(1);
    expect(serialized).not.toContain("~/.gemini/GEMINI.md");
    expect(serialized).not.toContain("stale retired content");
  });

  test("reports an installed inbox skill with no conversations watcher as unhealthy metadata", async () => {
    const db = getDatabase();
    const skillDir = join(tempDir, ".claude", "skills", "inbox");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: inbox\n---\n");

    const status = await getConfigsStatus(new LocalConfigStore(db), {
      homeDir: tempDir,
      conversationsCommand: join(tempDir, "missing-conversations"),
    });

    expect(status.counts.managedSkillRuntimes).toEqual({
      skillsPresent: 1,
      healthy: 0,
      missing: 1,
    });
    expect(status.health.missingManagedSkillRuntimes).toBe(1);
    expect(status.health.hasMissingManagedSkillRuntimes).toBe(true);
    expect(status.health.status).toBe("warn");
    expect(JSON.stringify(status)).not.toContain(skillDir);
  });
});

/**
 * The hosted N+1 that made `instructions status` look hung on station03
 * (fleet probe 2026-09-11: killed at 40 s, exit 142). `counts.profileLinks`
 * and `counts.snapshots` cost ONE HTTP round trip per profile and per config;
 * with 258 configs that was 120 s of serial reads — and ~35 s even with the
 * reads bounded-concurrent, because the ceiling is the service's throughput,
 * not the client's request pattern. So a default hosted status must not issue
 * them at all, and must say `null` rather than invent a number.
 */
describe("getConfigsStatus per-row counts follow the transport", () => {
  function countingStore(mode: "api" | "local") {
    const calls = { listSnapshots: 0, getProfileConfigs: 0 };
    const config = {
      id: "cfg-1",
      slug: "cfg-1",
      name: "cfg 1",
      kind: "reference" as const,
      category: "rules",
      agent: "global",
      target_path: null,
      format: "markdown",
      content: "body",
      description: null,
      tags: [],
      is_template: false,
      version: 1,
      outputs: [],
      created_at: "2026-09-11T00:00:00.000Z",
      updated_at: "2026-09-11T00:00:00.000Z",
      synced_at: null,
    };
    const store = {
      mode,
      v1BaseUrl: mode === "api" ? "https://api.hasna.com/instructions/v1" : null,
      listConfigs: async () => [config],
      getConfigStats: async () => ({ total: 1, rules: 1 }),
      listProfiles: async () => [{ id: "prof-1", slug: "p", name: "p" }],
      listMachines: async () => [],
      getProfileConfigs: async () => {
        calls.getProfileConfigs += 1;
        return [config];
      },
      listSnapshots: async () => {
        calls.listSnapshots += 1;
        return [{ id: "snap-1" }];
      },
    };
    return { store: store as unknown as Parameters<typeof getConfigsStatus>[0], calls };
  }

  test("a hosted store reports them as null and makes no per-row request", async () => {
    const { store, calls } = countingStore("api");
    const status = await getConfigsStatus(store, { homeDir: tempDir });
    expect(status.counts.snapshots).toBeNull();
    expect(status.counts.profileLinks).toBeNull();
    expect(calls).toEqual({ listSnapshots: 0, getProfileConfigs: 0 });
    // The cheap aggregate counts are still real.
    expect(status.counts.profiles).toBe(1);
    expect(status.counts.configs.total).toBe(1);
  });

  test("--deep counts them against a hosted store", async () => {
    const { store, calls } = countingStore("api");
    const status = await getConfigsStatus(store, { homeDir: tempDir, deep: true });
    expect(status.counts.snapshots).toBe(1);
    expect(status.counts.profileLinks).toBe(1);
    expect(calls).toEqual({ listSnapshots: 1, getProfileConfigs: 1 });
  });

  test("the on-box store counts them by default — they are free there", async () => {
    const { store, calls } = countingStore("local");
    const status = await getConfigsStatus(store, { homeDir: tempDir });
    expect(status.counts.snapshots).toBe(1);
    expect(status.counts.profileLinks).toBe(1);
    expect(calls).toEqual({ listSnapshots: 1, getProfileConfigs: 1 });
  });
});
