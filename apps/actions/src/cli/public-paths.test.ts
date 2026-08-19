import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SQLiteActionsStore } from "../storage.js";
import type { ActionManifest, ActionRun } from "../types.js";

const packageRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(packageRoot, "src", "cli", "index.ts");

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function cli(dir: string, args: string[]): CliResult {
  const result = Bun.spawnSync([process.execPath, cliEntry, "--dir", dir, ...args], {
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function shellManifest(id: string, overrides: Partial<ActionManifest> = {}): ActionManifest {
  return {
    id,
    name: `Echo ${id}`,
    version: "1.0.0",
    description: "Echoes the input name back as a message.",
    inputSchema: { type: "object", required: ["name"] },
    outputSchema: { type: "object", required: ["message"] },
    actor: { types: ["human", "agent"], required: true },
    resource: { type: "local-process", identifiers: ["name"] },
    scope: { level: "local", permissions: ["shell:execute"] },
    riskLevel: "low",
    requiredApprovals: [],
    idempotency: { supported: true, required: false },
    dryRun: { supported: true, default: false },
    confirmation: { title: "Echo input", summaryTemplate: "Echo {{name}}" },
    audit: { eventTypes: ["action.planned", "action.previewed", "action.executed"] },
    evidence: { required: false },
    rollback: { strategy: "none" },
    executorBindings: [{
      kind: "local-shell",
      command: process.execPath,
      args: ["-e", "const s = await new Response(Bun.stdin.stream()).text(); console.log(JSON.stringify({ message: JSON.parse(s).name.toUpperCase() }))"],
    }],
    ...overrides,
  };
}

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "actions-cli-pub-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("actions CLI public paths", () => {
  test("--dry-run reports previewed and never executes the shell command", async () => {
    await withDir(async (dir) => {
      const marker = join(dir, "executed.marker");
      const manifestPath = join(dir, "dry-run-manifest.json");
      writeFileSync(manifestPath, JSON.stringify(shellManifest("cli.dry.run", {
        executorBindings: [{
          kind: "local-shell",
          command: process.execPath,
          args: ["-e", `const { writeFileSync } = await import("node:fs"); writeFileSync(${JSON.stringify(marker)}, "ran");`],
        }],
      })));

      const dry = cli(dir, ["run", manifestPath, "--input", '{"name":"x"}', "--dry-run", "--json"]);
      expect(dry.exitCode).toBe(0);
      expect((JSON.parse(dry.stdout) as ActionRun).status).toBe("previewed");
      expect(existsSync(marker)).toBe(false);

      // Two-sided: the same manifest without --dry-run executes and writes the marker.
      const executed = cli(dir, ["run", manifestPath, "--input", '{"name":"x"}', "--json"]);
      expect(executed.exitCode).toBe(0);
      expect((JSON.parse(executed.stdout) as ActionRun).status).toBe("succeeded");
      expect(existsSync(marker)).toBe(true);
    });
  });

  test("--input-file parses the supplied JSON file", async () => {
    await withDir(async (dir) => {
      const manifestPath = join(dir, "input-file-manifest.json");
      const inputPath = join(dir, "input.json");
      writeFileSync(manifestPath, JSON.stringify(shellManifest("cli.input.file")));
      writeFileSync(inputPath, JSON.stringify({ name: "file-input" }));

      const result = cli(dir, ["run", manifestPath, "--input-file", inputPath, "--json"]);
      expect(result.exitCode).toBe(0);
      const run = JSON.parse(result.stdout) as ActionRun;
      expect(run.status).toBe("succeeded");
      expect(run.output).toEqual({ message: "FILE-INPUT" });
    });
  });

  test("a missing required idempotency key fails with the exact error", async () => {
    await withDir(async (dir) => {
      const manifestPath = join(dir, "idem-manifest.json");
      writeFileSync(manifestPath, JSON.stringify(shellManifest("cli.idem.required", {
        idempotency: { supported: true, required: true },
      })));

      const result = cli(dir, ["run", manifestPath, "--input", '{"name":"x"}', "--json"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Action cli.idem.required requires an idempotency key");

      // Two-sided: supplying the key succeeds.
      const withKey = cli(dir, ["run", manifestPath, "--input", '{"name":"x"}', "--idempotency-key", "cli-key-1", "--json"]);
      expect(withKey.exitCode).toBe(0);
    });
  });

  test("an invalid manifest fails with a non-zero exit and the validation error", async () => {
    await withDir(async (dir) => {
      const manifestPath = join(dir, "invalid-manifest.json");
      const { description, ...rest } = shellManifest("cli.invalid.manifest");
      void description;
      writeFileSync(manifestPath, JSON.stringify(rest));

      const result = cli(dir, ["run", manifestPath, "--input", '{"name":"x"}', "--json"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Invalid action manifest; missing description");
    });
  });

  test("approving a missing run id reports 'Action run not found' with a non-zero exit", async () => {
    await withDir(async (dir) => {
      const result = cli(dir, ["approve", "missing-run-id-1234", "--json"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Action run not found: missing-run-id-1234");
    });
  });

  test("an ambiguous shared prefix reports 'not found or prefix is ambiguous'", async () => {
    await withDir(async (dir) => {
      const store = new SQLiteActionsStore(dir);
      await store.saveManifest(shellManifest("examples.alpha"));
      await store.saveManifest(shellManifest("examples.alphabet"));
      await store.createRun({
        id: "run-shared-1",
        actionId: "examples.alpha",
        actionVersion: "1.0.0",
        status: "planned",
        input: {},
        plan: [],
        riskLevel: "low",
        requiredApprovals: [],
        approvals: [],
        guardrailResults: [],
        evidence: [],
        dryRun: true,
        confirmationSummary: "Echo",
        rollback: { strategy: "none" },
        events: [],
        metadata: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } satisfies ActionRun);
      await store.createRun({
        id: "run-shared-2",
        actionId: "examples.alpha",
        actionVersion: "1.0.0",
        status: "planned",
        input: {},
        plan: [],
        riskLevel: "low",
        requiredApprovals: [],
        approvals: [],
        guardrailResults: [],
        evidence: [],
        dryRun: true,
        confirmationSummary: "Echo",
        rollback: { strategy: "none" },
        events: [],
        metadata: {},
        createdAt: "2026-01-01T00:00:01.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      } satisfies ActionRun);

      const manifestResult = cli(dir, ["manifests", "show", "examples.a", "--json"]);
      expect(manifestResult.exitCode).not.toBe(0);
      expect(manifestResult.stderr).toContain("Manifest not found or prefix is ambiguous: examples.a");

      const runResult = cli(dir, ["runs", "show", "run-shared", "--json"]);
      expect(runResult.exitCode).not.toBe(0);
      expect(runResult.stderr).toContain("Run not found or prefix is ambiguous: run-shared");

      // Two-sided: the exact manifest id resolves.
      const exact = cli(dir, ["manifests", "show", "examples.alpha", "--json"]);
      expect(exact.exitCode).toBe(0);
      expect((JSON.parse(exact.stdout) as ActionManifest).id).toBe("examples.alpha");
    });
  });

  test("malformed --input JSON fails with a parse error and a non-zero exit", async () => {
    await withDir(async (dir) => {
      const manifestPath = join(dir, "malformed-input-manifest.json");
      writeFileSync(manifestPath, JSON.stringify(shellManifest("cli.malformed.input")));

      const result = cli(dir, ["run", manifestPath, "--input", "{bad", "--json"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("JSON Parse error");

      // Two-sided: well-formed inline input succeeds.
      const good = cli(dir, ["run", manifestPath, "--input", '{"name":"inline"}', "--json"]);
      expect(good.exitCode).toBe(0);
    });
  });

  test("actions CLI requires an executable data dir for run and status without network", async () => {
    await withDir(async (dir) => {
      const status = cli(dir, ["status", "--json"]);
      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({ service: "actions", counts: { manifests: 0, runs: 0 } });
    });
  });
});
