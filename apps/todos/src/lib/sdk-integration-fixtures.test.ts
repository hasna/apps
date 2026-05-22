import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { validateJsonContract } from "../json-contracts.js";
import { withNoNetwork } from "../test/no-network.js";
import { validatePublicTextSurfaces } from "./public-release-gate.js";
import {
  createSdkIntegrationFixturePack,
  listSdkIntegrationExamples,
  writeSdkIntegrationFixtures,
} from "./sdk-integration-fixtures.js";

const root = join(import.meta.dir, "../..");
const examplesRoot = join(root, "examples/sdk-integrations");

let previousDbPath: string | undefined;
let previousHome: string | undefined;
let home: string;

beforeEach(() => {
  previousDbPath = process.env["TODOS_DB_PATH"];
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-sdk-fixtures-home-"));
  process.env["HOME"] = home;
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
  else process.env["TODOS_DB_PATH"] = previousDbPath;
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("SDK integration fixtures", () => {
  test("publishes examples for SDK CLI JSON MCP and agent adapters", () => {
    const examples = listSdkIntegrationExamples();
    expect(examples.map((example) => example.surface)).toEqual(["sdk", "cli-json", "mcp", "agent-adapter"]);

    for (const example of examples) {
      expect(statSync(join(root, example.file)).isFile()).toBe(true);
      expect(example.command).toStartWith("bun examples/sdk-integrations/");
    }

    const contract = JSON.parse(readFileSync(join(examplesRoot, "contracts.json"), "utf-8"));
    expect(contract.localOnly).toBe(true);
    expect(contract.noNetworkRequired).toBe(true);
    expect(contract.stableJsonContracts).toContain("sdk_integration_fixture_pack");
  });

  test("creates a local-only fixture pack with contract snapshots and no network calls", async () => {
    const { result: pack, calls } = await withNoNetwork(() => createSdkIntegrationFixturePack({
      version: "1.2.3",
      generatedAt: "2026-05-22T00:00:00.000Z",
    }));

    expect(calls).toEqual([]);
    expect(pack).toMatchObject({
      schema_version: 1,
      local_only: true,
      no_network_required: true,
      package: {
        packageName: "@hasna/todos",
        repository: "hasna/todos",
        version: "1.2.3",
      },
    });
    expect(pack.fixture_database.task_ids).toHaveLength(4);
    expect(pack.contract_snapshots.json_contracts.contracts.map((contract) => contract.id)).toContain("sdk_integration_fixture_pack");
    expect(pack.contract_snapshots.local_snapshot_resources.map((resource) => resource.type)).toEqual([
      "projects",
      "tasks",
      "plans",
      "runs",
      "dependencies",
      "events",
      "evidence",
    ]);
    expect(pack.contract_snapshots.snapshots.projects.count).toBe(1);
    expect(pack.contract_snapshots.snapshots.tasks.count).toBe(4);
    expect(pack.contract_snapshots.snapshots.plans.count).toBe(1);
    expect(pack.contract_snapshots.snapshots.runs.count).toBe(1);
    expect(pack.contract_snapshots.snapshots.evidence.count).toBeGreaterThan(0);
    expect(pack.contract_snapshots.context_pack.task.id).toBe(pack.fixture_database.task_ids[0]);
    expect(validateJsonContract("sdk_integration_fixture_pack", pack)).toEqual({
      ok: true,
      contractId: "sdk_integration_fixture_pack",
      missingRequired: [],
      typeMismatches: [],
    });
  });

  test("writes fixture files that downstream tools can parse", () => {
    const dir = mkdtempSync(join(tmpdir(), "todos-sdk-fixtures-"));
    try {
      const result = writeSdkIntegrationFixtures(dir, {
        version: "1.2.3",
        generatedAt: "2026-05-22T00:00:00.000Z",
      });

      expect(result.files.map((file) => relative(dir, file))).toEqual([
        "fixture-pack.json",
        "agent-project-demo.bridge.json",
        "contract-snapshots.json",
        "examples.json",
      ]);
      for (const file of result.files) expect(existsSync(file)).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, "fixture-pack.json"), "utf-8")).fixture_database.task_ids).toHaveLength(4);
      expect(JSON.parse(readFileSync(join(dir, "agent-project-demo.bridge.json"), "utf-8")).data.tasks).toHaveLength(4);
      expect(JSON.parse(readFileSync(join(dir, "contract-snapshots.json"), "utf-8")).snapshots.tasks.type).toBe("tasks");
      expect(JSON.parse(readFileSync(join(dir, "examples.json"), "utf-8"))).toHaveLength(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("examples and docs stay on public local package surfaces", () => {
    const files = [
      "README.md",
      "docs/sdk-integrations.md",
      "examples/sdk-integrations/bun-sdk.ts",
      "examples/sdk-integrations/cli-json-consumer.ts",
      "examples/sdk-integrations/mcp-client.ts",
      "examples/sdk-integrations/agent-adapter.ts",
      "examples/sdk-integrations/contracts.json",
    ];

    const surfaces = files.map((path) => ({ path, text: readFileSync(join(root, path), "utf-8") }));
    expect(validatePublicTextSurfaces(surfaces)).toEqual([]);

    const forbidden = [
      /platform-todos/i,
      /hasnastudio/i,
      /\bTODOS_API_URL\b/,
      /\bTODOS_MODE\b/,
      /https:\/\/api\./i,
      /npm install\s/i,
      /@hasnastudio\//i,
    ];
    const offenders: string[] = [];
    for (const surface of surfaces.filter((item) => item.path !== "README.md")) {
      for (const pattern of forbidden) {
        if (pattern.test(surface.text)) offenders.push(`${surface.path}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
