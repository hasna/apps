import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPackageVersion } from "./package-version.js";
import { createCliMcpParityManifest } from "../cli-mcp-parity.js";
import { getTask } from "../db/tasks.js";
import { createJsonContractsManifest } from "../json-contracts.js";
import { createAgentContextPack } from "./context-packs.js";
import { getOnboardingFixtureBundle, importOnboardingFixture } from "./onboarding-fixtures.js";
import { getLocalSnapshot, listLocalSnapshotResources } from "./local-snapshots.js";

export const TODOS_SDK_INTEGRATION_FIXTURE_SCHEMA_VERSION = 1;
export const TODOS_SDK_INTEGRATION_FIXTURE_GENERATED_AT = "2026-05-22T00:00:00.000Z";

export type SdkIntegrationExampleSurface = "sdk" | "cli-json" | "mcp" | "agent-adapter";

export interface SdkIntegrationExample {
  id: string;
  surface: SdkIntegrationExampleSurface;
  file: string;
  command: string;
  consumes: string[];
}

export interface SdkIntegrationFixtureDatabase {
  mode: "local-sqlite";
  seed: "onboarding-bridge-import";
  seed_command: string;
  reset_command: string;
  project_id: string;
  task_ids: string[];
  plan_id: string;
  run_id: string;
}

export interface SdkIntegrationFixturePack {
  schema_version: typeof TODOS_SDK_INTEGRATION_FIXTURE_SCHEMA_VERSION;
  local_only: true;
  no_network_required: true;
  generated_at: string;
  package: {
    packageName: "@hasna/todos";
    repository: "hasna/todos";
    version: string;
  };
  fixture_database: SdkIntegrationFixtureDatabase;
  examples: SdkIntegrationExample[];
  contract_snapshots: {
    json_contracts: ReturnType<typeof createJsonContractsManifest>;
    cli_mcp_parity: ReturnType<typeof createCliMcpParityManifest>;
    local_snapshot_resources: ReturnType<typeof listLocalSnapshotResources>;
    snapshots: {
      projects: ReturnType<typeof getLocalSnapshot>;
      tasks: ReturnType<typeof getLocalSnapshot>;
      plans: ReturnType<typeof getLocalSnapshot>;
      runs: ReturnType<typeof getLocalSnapshot>;
      evidence: ReturnType<typeof getLocalSnapshot>;
    };
    context_pack: ReturnType<typeof createAgentContextPack>;
  };
}

export interface WriteSdkIntegrationFixturesResult {
  directory: string;
  files: string[];
  pack: SdkIntegrationFixturePack;
}

function source(version: string) {
  return {
    packageName: "@hasna/todos" as const,
    repository: "hasna/todos" as const,
    version,
  };
}

export function listSdkIntegrationExamples(): SdkIntegrationExample[] {
  return [
    {
      id: "bun-sdk-local-server",
      surface: "sdk",
      file: "examples/sdk-integrations/bun-sdk.ts",
      command: "bun examples/sdk-integrations/bun-sdk.ts",
      consumes: ["tasks", "projects", "plans", "runs"],
    },
    {
      id: "cli-json-consumer",
      surface: "cli-json",
      file: "examples/sdk-integrations/cli-json-consumer.ts",
      command: "bun examples/sdk-integrations/cli-json-consumer.ts",
      consumes: ["task JSON", "snapshot JSON", "context pack JSON"],
    },
    {
      id: "mcp-stdio-client",
      surface: "mcp",
      file: "examples/sdk-integrations/mcp-client.ts",
      command: "bun examples/sdk-integrations/mcp-client.ts",
      consumes: ["list_tasks", "get_local_snapshot", "build_agent_context_pack"],
    },
    {
      id: "agent-adapter-local-run",
      surface: "agent-adapter",
      file: "examples/sdk-integrations/agent-adapter.ts",
      command: "bun examples/sdk-integrations/agent-adapter.ts",
      consumes: ["ready tasks", "context packs", "verification evidence"],
    },
  ];
}

function ensureFixtureImported(): SdkIntegrationFixtureDatabase {
  const bundle = getOnboardingFixtureBundle("agent-project-demo");
  importOnboardingFixture({ name: "agent-project-demo", dryRun: false, conflictStrategy: "safe_merge" });
  const firstTask = bundle.data.tasks[0];
  const taskIds = bundle.data.tasks.map((task) => task.id);
  const plan = bundle.data.plans[0];
  const run = bundle.data.runs[0];
  if (!firstTask || !plan || !run || !getTask(firstTask.id)) {
    throw new Error("SDK integration fixture import did not create the expected local task records");
  }
  return {
    mode: "local-sqlite",
    seed: "onboarding-bridge-import",
    seed_command: "todos onboarding --import agent-project-demo --apply --json",
    reset_command: "rm -f .todos/sdk-integration-fixture.db",
    project_id: bundle.source.project_id!,
    task_ids: taskIds,
    plan_id: plan.id,
    run_id: run.id,
  };
}

export function createSdkIntegrationFixturePack(options: {
  generatedAt?: string;
  version?: string;
} = {}): SdkIntegrationFixturePack {
  const generatedAt = options.generatedAt ?? TODOS_SDK_INTEGRATION_FIXTURE_GENERATED_AT;
  const version = options.version ?? getPackageVersion(import.meta.url);
  const fixtureDatabase = ensureFixtureImported();
  const taskId = fixtureDatabase.task_ids[0]!;

  return {
    schema_version: TODOS_SDK_INTEGRATION_FIXTURE_SCHEMA_VERSION,
    local_only: true,
    no_network_required: true,
    generated_at: generatedAt,
    package: source(version),
    fixture_database: fixtureDatabase,
    examples: listSdkIntegrationExamples(),
    contract_snapshots: {
      json_contracts: createJsonContractsManifest({ version, generatedAt }),
      cli_mcp_parity: createCliMcpParityManifest({ version, generatedAt }),
      local_snapshot_resources: listLocalSnapshotResources(),
      snapshots: {
        projects: getLocalSnapshot({ type: "projects", generatedAt, project_id: fixtureDatabase.project_id }),
        tasks: getLocalSnapshot({ type: "tasks", generatedAt, project_id: fixtureDatabase.project_id }),
        plans: getLocalSnapshot({ type: "plans", generatedAt, project_id: fixtureDatabase.project_id }),
        runs: getLocalSnapshot({ type: "runs", generatedAt, project_id: fixtureDatabase.project_id }),
        evidence: getLocalSnapshot({ type: "evidence", generatedAt, project_id: fixtureDatabase.project_id }),
      },
      context_pack: createAgentContextPack({
        task_id: taskId,
        profile: "codex",
        now: generatedAt,
        run_limit: 2,
        verification_limit: 5,
      }),
    },
  };
}

export function writeSdkIntegrationFixtures(directory: string, options: {
  generatedAt?: string;
  version?: string;
} = {}): WriteSdkIntegrationFixturesResult {
  mkdirSync(directory, { recursive: true });
  const pack = createSdkIntegrationFixturePack(options);
  const bundle = getOnboardingFixtureBundle("agent-project-demo");
  const files = [
    ["fixture-pack.json", pack],
    ["agent-project-demo.bridge.json", bundle],
    ["contract-snapshots.json", pack.contract_snapshots],
    ["examples.json", pack.examples],
  ] as const;
  const written: string[] = [];
  for (const [name, payload] of files) {
    const file = join(directory, name);
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    written.push(file);
  }
  return { directory, files: written, pack };
}
