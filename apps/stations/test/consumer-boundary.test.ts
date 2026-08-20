import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const sourceRoot = join(repoRoot, "src");

const forbiddenConsumerModules = [
  "src/cli/",
  "src/mcp/",
  "src/agent/",
  "src/cli-utils.ts",
  "src/storage.ts",
  "src/storage-sync.ts",
  "src/remote-storage.ts",
  "src/pg-migrations.ts",
  "src/commands/install-claude.ts",
  "src/commands/install-tailscale.ts",
  "src/commands/setup.ts",
  "src/commands/serve.ts",
] as const;

function relativeSourcePath(path: string): string {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

function fixtureOwnedStderr(stderr: string, fixtureRoot: string): string {
  return stderr
    .split(/\n\s*\n/)
    .filter((block) => {
      if (!block.includes("warn: Duplicate key")) return block.trim().length > 0;
      const warningSource = block.match(/\bat (.+\.json):\d+:\d+\s*$/)?.[1];
      if (!warningSource) return true;
      const warningPath = relative(fixtureRoot, resolve(warningSource));
      return warningPath === ""
        || (warningPath !== ".." && !warningPath.startsWith(`..${sep}`) && !isAbsolute(warningPath));
    })
    .join("\n\n")
    .trim();
}

function parseRelativeImports(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  const specs: string[] = [];
  const regex = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw))) {
    if (match[1]?.startsWith(".")) specs.push(match[1]);
  }
  return specs;
}

function resolveSourceImport(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ".ts"));
  const candidates = [
    base,
    `${base}.ts`,
    join(base, "index.ts"),
  ];
  return candidates.find((candidate) => candidate.startsWith(sourceRoot) && existsSync(candidate)) ?? null;
}

function consumerSourceGraph(): string[] {
  const entry = join(sourceRoot, "consumer.ts");
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const spec of parseRelativeImports(current)) {
      const resolved = resolveSourceImport(current, spec);
      if (resolved) pending.push(resolved);
    }
  }
  return [...seen].map(relativeSourcePath).sort();
}

describe("consumer entrypoint boundary", () => {
  test("imports @hasna/stations/consumer from a temp app", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "stations-consumer-boundary-parent-"));
    const dir = join(fixtureRoot, "app");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(fixtureRoot, "package.json"),
        '{"dependencies":{"@hasna/todos":"0.1.0","@hasna/todos":"0.2.0"}}\n',
        "utf8",
      );
      const packageRoot = join(dir, "node_modules", "@hasna", "stations");
      mkdirSync(join(packageRoot, "dist"), { recursive: true });
      const build = await Bun.build({
        entrypoints: [join(sourceRoot, "consumer.ts")],
        outdir: join(packageRoot, "dist"),
        target: "bun",
        format: "esm",
      });
      expect(build.success).toBe(true);
      expect(build.outputs.map((output) => output.path.split("/").pop())).toContain("consumer.js");

      writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
        name: "@hasna/stations",
        version: "0.0.0-boundary-test",
        type: "module",
        exports: {
          "./consumer": {
            import: "./dist/consumer.js",
          },
        },
      }, null, 2));
      writeFileSync(join(dir, "app.mjs"), `
        import {
          STATIONS_CONSUMER_CONTRACT,
          STATIONS_CONSUMER_CONTRACT_VERSION,
          createMachineResolverSnapshot,
          getCommandMatrix,
          getBrowserPlanFleet,
          getFleetLoopPreflight,
          getFleetMachineHealth,
          getFleetRouting,
          getDispatchFleetSmoke,
          getMachineDetails,
          listMachineTrashPolicies,
          resolveNoteMachineContext,
          resolveMachineWorkspace,
          validateStationsConsumerEnvelope,
        } from "@hasna/stations/consumer";

        console.log(JSON.stringify({
          contract_version: STATIONS_CONSUMER_CONTRACT_VERSION,
          entrypoint: STATIONS_CONSUMER_CONTRACT.entrypoint,
          has_workspace_resolver: typeof resolveMachineWorkspace === "function",
          has_snapshot_helper: typeof createMachineResolverSnapshot === "function",
          has_browserplan_fleet: typeof getBrowserPlanFleet === "function",
          has_machine_health: typeof getFleetMachineHealth === "function",
          has_fleet_routing: typeof getFleetRouting === "function",
          has_command_matrix: typeof getCommandMatrix === "function",
          has_loop_preflight: typeof getFleetLoopPreflight === "function",
          has_dispatch_fleet_smoke: typeof getDispatchFleetSmoke === "function",
          has_machine_details: typeof getMachineDetails === "function",
          has_note_context: typeof resolveNoteMachineContext === "function",
          has_trash_policies: typeof listMachineTrashPolicies === "function",
          has_validator: typeof validateStationsConsumerEnvelope === "function",
          schema_artifact: STATIONS_CONSUMER_CONTRACT.schema_artifact,
          capabilities: STATIONS_CONSUMER_CONTRACT.capabilities,
        }));
      `);

      const result = spawnSync(process.execPath, ["app.mjs"], {
        cwd: dir,
        env: {
          ...process.env,
          HASNA_STATIONS_DB_PATH: join(dir, "stations.db"),
          HASNA_STATIONS_MANIFEST_PATH: join(dir, "stations.json"),
          HASNA_STATIONS_MACHINE_ID: "consumer-boundary",
        },
        encoding: "utf8",
      });

      expect(result.stderr).toContain(join(fixtureRoot, "package.json"));
      expect(fixtureOwnedStderr(result.stderr, dir)).toBe("");
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toEqual({
        contract_version: 1,
        entrypoint: "@hasna/stations/consumer",
        has_workspace_resolver: true,
        has_snapshot_helper: true,
        has_browserplan_fleet: true,
        has_machine_health: true,
        has_fleet_routing: true,
        has_command_matrix: true,
        has_loop_preflight: true,
        has_dispatch_fleet_smoke: true,
        has_machine_details: true,
        has_note_context: true,
        has_trash_policies: true,
        has_validator: true,
        schema_artifact: "schemas/stations-consumer.schema.json",
        capabilities: {
          topology: true,
          compatibility: true,
          route_resolution: true,
          cli_json_fallback: true,
          workspace_path_mapping: true,
          workspace_diagnostics: true,
          schema_artifacts: true,
          cacheability_metadata: true,
          resolver_snapshots: true,
          field_capability_descriptors: true,
          project_assignments: true,
          friendly_machine_names: true,
          machine_list_pagination: true,
          note_machine_context: true,
          machine_trash_policies: true,
          machine_details: true,
          browserplan_fleet: true,
          machine_health: true,
          fleet_routing: true,
          command_matrix: true,
          loop_preflight: true,
          dispatch_fleet_smoke: true,
        },
      });
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("filters only duplicate-key warnings from package manifests outside the temp app", () => {
    const appRoot = join(tmpdir(), "stations-consumer-boundary-filter", "app");
    const warning = (path: string) => [
      '1 | {"dependencies":{"duplicate":"one","duplicate":"two"}}',
      "                                      ^",
      'warn: Duplicate key "duplicate" in object literal',
      `    at ${path}:1:39`,
      "",
    ].join("\n");

    expect(fixtureOwnedStderr(warning(join(dirname(appRoot), "package.json")), appRoot)).toBe("");
    expect(fixtureOwnedStderr(warning(join(appRoot, "package.json")), appRoot))
      .toContain(join(appRoot, "package.json"));
    expect(fixtureOwnedStderr("consumer runtime failure\n", appRoot)).toBe("consumer runtime failure");
  });

  test("does not import CLI, MCP, agent, install, or storage-heavy modules", () => {
    const graph = consumerSourceGraph();
    for (const forbidden of forbiddenConsumerModules) {
      expect(graph.filter((path) => path.startsWith(forbidden) || path === forbidden)).toEqual([]);
    }
  });
});
