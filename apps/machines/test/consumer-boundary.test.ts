import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

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
  test("imports @hasna/machines/consumer from a temp app", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-consumer-app-"));
    try {
      const packageRoot = join(dir, "node_modules", "@hasna", "machines");
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
        name: "@hasna/machines",
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
          MACHINES_CONSUMER_CONTRACT,
          MACHINES_CONSUMER_CONTRACT_VERSION,
          createMachineResolverSnapshot,
          getMachineDetails,
          listMachineTrashPolicies,
          resolveNoteMachineContext,
          resolveMachineWorkspace,
          validateMachinesConsumerEnvelope,
        } from "@hasna/machines/consumer";

        console.log(JSON.stringify({
          contract_version: MACHINES_CONSUMER_CONTRACT_VERSION,
          entrypoint: MACHINES_CONSUMER_CONTRACT.entrypoint,
          has_workspace_resolver: typeof resolveMachineWorkspace === "function",
          has_snapshot_helper: typeof createMachineResolverSnapshot === "function",
          has_machine_details: typeof getMachineDetails === "function",
          has_note_context: typeof resolveNoteMachineContext === "function",
          has_trash_policies: typeof listMachineTrashPolicies === "function",
          has_validator: typeof validateMachinesConsumerEnvelope === "function",
          schema_artifact: MACHINES_CONSUMER_CONTRACT.schema_artifact,
          capabilities: MACHINES_CONSUMER_CONTRACT.capabilities,
        }));
      `);

      const result = spawnSync(process.execPath, ["app.mjs"], {
        cwd: dir,
        env: {
          ...process.env,
          HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
          HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
          HASNA_MACHINES_MACHINE_ID: "consumer-boundary",
        },
        encoding: "utf8",
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toEqual({
        contract_version: 1,
        entrypoint: "@hasna/machines/consumer",
        has_workspace_resolver: true,
        has_snapshot_helper: true,
        has_machine_details: true,
        has_note_context: true,
        has_trash_policies: true,
        has_validator: true,
        schema_artifact: "schemas/machines-consumer.schema.json",
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
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not import CLI, MCP, agent, install, or storage-heavy modules", () => {
    const graph = consumerSourceGraph();
    for (const forbidden of forbiddenConsumerModules) {
      expect(graph.filter((path) => path.startsWith(forbidden) || path === forbidden)).toEqual([]);
    }
  });
});
