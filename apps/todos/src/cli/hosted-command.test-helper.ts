import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const CALLS_MARKER = "__TODOS_COMMAND_CALLS__";

// Keep the positive Commander compatibility fixture behind the same private
// build-time seam as the cloud-router mapper tests. The production command
// graph continues to import the unconditional Stage-A floor; only this
// disposable test bundle replaces its private operation guard.
const fixtureBundleRoot = mkdtempSync(join(tmpdir(), "todos-command-fixture-bundle-"));
const fixtureBuild = await Bun.build({
  entrypoints: [join(REPO_ROOT, "src/cli/hosted-command.test-fixture.ts")],
  outdir: fixtureBundleRoot,
  target: "bun",
  format: "esm",
  plugins: [{
    name: "future-hosted-command-contract-harness",
    setup(builder) {
      builder.onLoad({ filter: /cloud-router\.ts$/ }, async ({ path }) => {
        const source = await Bun.file(path).text();
        const pattern = /function authorizedCloudClient\(_client: HasnaStorageClient\): HasnaStorageClient \{[\s\S]*?\n\}/;
        const transformed = source.replace(
          pattern,
          "function authorizedCloudClient(_client: HasnaStorageClient): HasnaStorageClient { return _client; }",
        );
        if (transformed === source) {
          throw new Error("hosted command authority harness replacement did not match");
        }
        return { contents: transformed, loader: "ts" };
      });
    },
  }],
});
if (!fixtureBuild.success) {
  rmSync(fixtureBundleRoot, { recursive: true, force: true });
  throw new Error(fixtureBuild.logs.map((entry) => entry.message).join("\n"));
}
const fixtureEntry = fixtureBuild.outputs.find((output) => output.kind === "entry-point");
if (!fixtureEntry) {
  rmSync(fixtureBundleRoot, { recursive: true, force: true });
  throw new Error("hosted command authority harness produced no entry point");
}
process.once("exit", () => rmSync(fixtureBundleRoot, { recursive: true, force: true }));

export interface InjectedHostedCommandCall {
  method: string;
  path: string;
  query: string;
  body?: unknown;
}

export interface InjectedHostedCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  calls: InjectedHostedCommandCall[];
}

export async function runInjectedHostedCommand(
  scenario: string,
  args: string[],
): Promise<InjectedHostedCommandResult> {
  const root = mkdtempSync(join(tmpdir(), "todos-command-layer-"));
  try {
    const processHandle = Bun.spawn([
      "bun",
      "run",
      fixtureEntry.path,
      ...args,
    ], {
      cwd: REPO_ROOT,
      env: localRoutingTestEnv({
        HOME: root,
        TMPDIR: root,
        TODOS_AUTO_PROJECT: "false",
        TODOS_COMMAND_FIXTURE_SCENARIO: scenario,
      }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, rawStderr] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
    ]);
    const markerIndex = rawStderr.lastIndexOf(CALLS_MARKER);
    if (markerIndex < 0) {
      return { exitCode, stdout, stderr: rawStderr, calls: [] };
    }
    const callsLine = rawStderr.slice(markerIndex + CALLS_MARKER.length).trim().split("\n", 1)[0] ?? "[]";
    const stderr = rawStderr.slice(0, markerIndex).trim();
    return {
      exitCode,
      stdout,
      stderr,
      calls: JSON.parse(callsLine) as InjectedHostedCommandCall[],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
