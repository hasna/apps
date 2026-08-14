import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
let testDir: string | undefined;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("project-panel CLI", () => {
  test("prints contract JSON for a files project", () => {
    const env = seedCliProject();
    const panelProc = run(["project-panel", "--project", "Swiss Bank Account", "--json", "--contract"], env);

    expect(panelProc.exitCode).toBe(0);
    const panel = JSON.parse(stdout(panelProc)) as {
      schema: string;
      projectId: string;
      provider: { kind: string };
      metrics: Array<{ id: string; value: unknown }>;
    };
    expect(panel.schema).toBe("hasna.project_panel.v1");
    expect(panel.projectId).toBe("swiss-bank-account");
    expect(panel.provider.kind).toBe("files");
    expect(panel.metrics.find((metric) => metric.id === "total_files")?.value).toBe(1);
  });
});

function seedCliProject(): NodeJS.ProcessEnv {
  testDir = mkdtempSync(join(tmpdir(), "files-project-panel-cli-"));
  const sourceRoot = join(testDir, "source");
  const dataDir = join(testDir, "data");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(sourceRoot, "potential-contract.pdf"), "redacted fixture\n");
  const env = {
    ...process.env,
    HASNA_FILES_DATA_DIR: dataDir,
    HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
  };
  expect(run(["sources", "add", sourceRoot, "--name", "swiss-docs"], env).exitCode).toBe(0);
  expect(run(["index"], env).exitCode).toBe(0);
  const projectCreate = run(["projects", "create", "Swiss Bank Account"], env);
  expect(projectCreate.exitCode).toBe(0);
  const projectId = stdout(projectCreate).match(/Project created: (\S+)/)?.[1];
  expect(projectId).toBeDefined();
  const files = JSON.parse(stdout(run(["list", "--json"], env))) as Array<{ id: string; name: string }>;
  const file = files.find((entry) => entry.name === "potential-contract.pdf");
  expect(file).toBeDefined();
  expect(run(["projects", "add", projectId!, file!.id], env).exitCode).toBe(0);
  return env;
}

function run(args: string[], env: NodeJS.ProcessEnv): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync({
    cmd: ["bun", "run", cliPath, ...args],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function stdout(result: ReturnType<typeof Bun.spawnSync>): string {
  return new TextDecoder().decode(result.stdout);
}
