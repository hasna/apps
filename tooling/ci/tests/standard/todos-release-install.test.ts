import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeGeneratedJavaScript } from "../../../../apps/events/scripts/normalize-bun-cache-comments.js";

const root = resolve(import.meta.dir, "../../../..");
type Step = { name?: string; run?: string; if?: unknown; "working-directory"?: string; "continue-on-error"?: unknown };
type Workflow = { jobs: Record<string, { defaults?: { run?: { "working-directory"?: string } }; steps: Step[] }> };
const readWorkflow = (name: string) => Bun.YAML.parse(readFileSync(join(root, ".github/workflows", name), "utf8")) as Workflow;
const commands = (step: Step) => step.run?.trim().split("\n").map(line => line.trim()).filter(Boolean);

describe("standard-adherence: Todos release dependency layout", () => {
  test("release uses CI's complete frozen root installation and ordered preparation", () => {
    const ci = readWorkflow("ci.yml").jobs.gates!;
    const release = readWorkflow("release-todos.yml").jobs.publish!;
    const install = release.steps.find(step => step.name === "Install locked release dependencies")!;
    expect(install).toBeDefined();
    expect(commands(install)).toEqual(commands(ci.steps.find(step => step.name === "Install")!));
    expect(commands(install)).toEqual(["bun install --frozen-lockfile --ignore-scripts", "bun run prepare:ordered"]);
    expect(install["working-directory"]).toBeUndefined();
    expect(release.defaults?.run?.["working-directory"]).toBeUndefined();
    expect(install.if).toBeUndefined();
    expect(install["continue-on-error"]).toBeUndefined();
    expect(release.steps.indexOf(install)).toBeLessThan(release.steps.findIndex(step => step.name === "Typecheck"));
  });

  test("the full peer layout reproduces the four tracked Events outputs used by release builds", () => {
    // A filtered Bun install changed only the peer-cache suffix in these four
    // bundles. Compare against committed bytes, not freshly generated working
    // files, so a preceding build cannot hide that layout drift.
    const output = mkdtempSync(join(tmpdir(), "todos-release-events-"));
    const events = join(root, "apps/events");
    const eventsPackage = JSON.parse(readFileSync(join(events, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    const buildRuntime = eventsPackage.scripts["build:runtime"]!;
    const contractsVersion = eventsPackage.dependencies["@hasna/contracts"]!;
    expect(contractsVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // Preserve the complete entrypoint groups: Bun's symbol naming also
    // depends on that group. Change only the destination, never the inputs.
    const buildCommands = buildRuntime.split("&&").map(command => command.trim().split(/\s+/)).filter(args => args[0] === "bun" && args[1] === "build");
    const groups = [
      { destination: "dist/cli", files: ["cli/index.js"] },
      { destination: "dist", files: ["index.js", "commander.js", "durable.js"] },
    ];
    try {
      for (const group of groups) {
        const command = buildCommands.find(args => args[args.indexOf("--outdir") + 1] === group.destination)!;
        expect(command).toBeDefined();
        // These two package-owned commands use literal arguments; refuse a
        // new shell expression instead of approximating its semantics.
        expect(command.every(arg => /^[a-zA-Z0-9_./@=-]+$/.test(arg))).toBe(true);
        const args = command.slice(1);
        args[args.indexOf("--outdir") + 1] = join(output, group.destination.slice("dist".length));
        const build = spawnSync(process.execPath, args, {
          cwd: events, encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
        });
        expect({ status: build.status, error: build.error?.message, stderr: build.stderr }).toEqual({ status: 0, error: undefined, stderr: "" });
      }
      // The release build runs the package-owned normalizer after every Bun
      // entrypoint group. Apply that same final phase to the redirected output
      // before comparing with the committed release bytes.
      normalizeGeneratedJavaScript(output, contractsVersion);
      for (const file of groups.flatMap(group => group.files)) {
        const tracked = execFileSync("git", ["show", `HEAD:apps/events/dist/${file}`], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
        expect(readFileSync(join(output, file)).equals(tracked)).toBe(true);
      }
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  }, 120_000);
});
