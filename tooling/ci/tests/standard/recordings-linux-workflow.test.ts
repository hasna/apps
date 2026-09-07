import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { planReleaseSuite } from "../../../../apps/recordings/scripts/release-suite-gate";

const root = resolve(import.meta.dir, "../../../..");
const workflowPath = resolve(root, ".github/workflows/recordings-linux.yml");
type Step = { id?: string; name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown>; "timeout-minutes"?: number; "working-directory"?: string; "continue-on-error"?: unknown };
type Workflow = { on: Record<string, { paths?: string[]; branches?: string[] }>; permissions: Record<string, string>; jobs: Record<string, { needs?: unknown; "runs-on": string; "timeout-minutes": number; steps: Step[]; "continue-on-error"?: unknown }> };
const read = () => Bun.YAML.parse(readFileSync(workflowPath, "utf8")) as Workflow;

describe("standard-adherence: independent Recordings Linux gate", () => {
  test("is discoverable, path-scoped and independent of aggregate test success", () => {
    const workflow = read();
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
    for (const trigger of ["pull_request", "push"]) {
      expect(workflow.on[trigger]?.paths).toEqual(expect.arrayContaining([
        "apps/recordings/**", "apps/contracts/**", "apps/events/**", "package.json", "bun.lock", "turbo.json",
        ".github/workflows/recordings-linux.yml", "tooling/ci/collect-recordings-diagnostics.py",
      ]));
      expect(workflow.on[trigger]?.paths).not.toContain("**");
    }
    expect(workflow.on.push?.branches).toEqual(["main"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(workflow.jobs)).toEqual(["package"]);
    expect(workflow.jobs.package?.needs).toBeUndefined();
    expect(workflow.jobs.package?.["runs-on"]).toBe("ubuntu-24.04");
    expect(workflow.jobs.package?.["timeout-minutes"]).toBe(75);
    const stepMinutes = workflow.jobs.package!.steps.map(step => step["timeout-minutes"]);
    expect(stepMinutes.every(minutes => Number.isInteger(minutes) && minutes! > 0)).toBe(true);
    expect(stepMinutes.reduce<number>((total, minutes) => total + minutes!, 0)).toBeLessThan(75);
    expect(workflow.jobs.package?.["continue-on-error"]).toBeUndefined();
  });

  test("pins tools and runs the complete package gate after a frozen focused build", () => {
    const steps = read().jobs.package!.steps;
    const find = (id: string) => steps.find(step => step.id === id)!;
    for (const step of steps) {
      expect(step["continue-on-error"]).toBeUndefined();
      expect(step.run ?? "").not.toMatch(/\|\|\s*true|--test-name-pattern|--verify-run/);
      if (step.uses) expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
    }
    const checkout = steps.find(step => step.uses?.startsWith("actions/checkout@"))!;
    expect(checkout.with?.["persist-credentials"]).toBe(false);
    expect(steps.find(step => step.uses?.startsWith("oven-sh/setup-bun@"))?.with?.["bun-version"]).toBe("1.3.14");
    expect(find("npm").run).toContain("npm@11.19.0 --ignore-scripts");
    expect(find("npm").run).toContain('test "$("$npm_prefix/bin/npm" --version)" = "11.19.0"');
    expect(find("npm").run).toContain('echo "$npm_prefix/bin" >> "$GITHUB_PATH"');
    expect(find("install").run?.trim()).toBe("bun install --frozen-lockfile --ignore-scripts");
    expect(find("build").run?.trim()).toBe("bunx turbo run build --filter=@hasna/recordings... --concurrency=1");
    expect(find("typecheck").run?.trim()).toBe("bun run typecheck");
    expect(find("typecheck")["working-directory"]).toBe("apps/recordings");
    expect(find("suite").run?.trim()).toBe("bun scripts/release-suite-gate.ts --all");
    expect(find("suite")["working-directory"]).toBe("apps/recordings");
    expect(find("suite")["timeout-minutes"]).toBeGreaterThan(31);
    expect(find("suite").env?.TMPDIR).toBe("${{ steps.reports.outputs.root }}/");
    for (const id of ["npm", "install", "build", "typecheck", "suite"]) expect(find(id).if).toBeUndefined();
    expect(["npm", "install", "build", "typecheck", "suite"].map(id => steps.indexOf(find(id))))
      .toEqual([...steps.entries()].filter(([, step]) => ["npm", "install", "build", "typecheck", "suite"].includes(step.id ?? "")).map(([index]) => index));
  });

  test("retains only collector output after failures, with short retention", () => {
    const steps = read().jobs.package!.steps;
    const collect = steps.find(step => step.id === "collect")!;
    expect(collect.if).toContain("always()");
    expect(collect.run).toBe('python3 -I -B tooling/ci/collect-recordings-diagnostics.py "${{ steps.reports.outputs.root }}" "${{ runner.temp }}/recordings-linux-diagnostics"');
    const upload = steps.find(step => step.uses?.startsWith("actions/upload-artifact@"))!;
    expect(upload.if).toContain("always()");
    expect(upload.with?.path).toBe("${{ runner.temp }}/recordings-linux-diagnostics/");
    expect(upload.with?.["retention-days"]).toBe(7);
    expect(upload.with?.["include-hidden-files"]).toBe(false);
  });

  test("the real Linux plan contains the entire dynamic inventory and isolates recorder", () => {
    const enumeration = spawnSync(process.execPath, ["scripts/ci-linux-suite.ts", "--all"], {
      cwd: resolve(root, "apps/recordings"), encoding: "utf8", timeout: 10_000,
    });
    expect(enumeration.status).toBe(0);
    expect(enumeration.error).toBeUndefined();
    const files = enumeration.stdout.trim().split("\n");
    const groups = planReleaseSuite(files, "linux");
    expect(groups.map(group => group.id)).toEqual(["recorder", "ordinary"]);
    expect(groups[0]?.files).toEqual(["src/__tests__/recorder.test.ts"]);
    expect(groups[0]?.runner).toBe("recorder");
    expect(groups[1]?.pattern).toBeUndefined();
    expect(groups.flatMap(group => group.files).sort()).toEqual(files.sort());
  });

  test("the diagnostics collector rejects unsafe or oversized fixture inputs", () => {
    const result = spawnSync("/usr/bin/python3", ["-I", "-B", "tooling/ci/tests/recordings-diagnostics.test.py"], {
      cwd: root, encoding: "utf8", timeout: 20_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("OK");
  });
});
