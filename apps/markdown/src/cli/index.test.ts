import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const fixtureDir = join(process.cwd(), ".tmp", "cli-tests");
const fixtureFile = join(fixtureDir, "valid.omp.md");

const validDoc = `# CliJson

---

type: project
id: init
name: cli-json
framework: nextjs@15
router: app
language: typescript
styling: tailwind
pkg: bun

Create the project scaffolding.
`;

function runCli(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("omp CLI JSON output", () => {
  test("validate --json outputs machine-readable payload", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixtureFile, validDoc);

    const result = runCli(["validate", fixtureFile, "--json"]);
    const stdout = Buffer.from(result.stdout).toString("utf8");

    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(stdout) as { valid: boolean; cards: number; errorCount: number; warningCount: number };
    expect(payload.valid).toBe(true);
    expect(payload.cards).toBeGreaterThan(0);
    expect(payload.errorCount).toBe(0);
    expect(payload.warningCount).toBe(0);

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("validate -j outputs machine-readable payload", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixtureFile, validDoc);

    const result = runCli(["validate", fixtureFile, "-j"]);
    const stdout = Buffer.from(result.stdout).toString("utf8");

    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(stdout) as { valid: boolean; cards: number };
    expect(payload.valid).toBe(true);
    expect(payload.cards).toBeGreaterThan(0);

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("inspect --json includes execution plan", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixtureFile, validDoc);

    const result = runCli(["inspect", fixtureFile, "--json"]);
    const stdout = Buffer.from(result.stdout).toString("utf8");

    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(stdout) as { title: string; executionPlan: { steps: unknown[] } };
    expect(payload.title).toBe("CliJson");
    expect(Array.isArray(payload.executionPlan.steps)).toBe(true);

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("run --json fails fast on unsupported provider", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixtureFile, validDoc);

    const result = runCli(["run", fixtureFile, "--dry-run", "--json", "--llm", "foo:gpt-x"]);
    const stdout = Buffer.from(result.stdout).toString("utf8");

    expect(result.exitCode).toBe(1);

    const payload = JSON.parse(stdout) as { error: string };
    expect(payload.error).toContain("Unsupported LLM provider: foo");
    expect(payload.error).toContain("anthropic, openai, ollama");

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("run -j fails fast on unsupported provider", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixtureFile, validDoc);

    const result = runCli(["run", fixtureFile, "--dry-run", "-j", "--llm", "foo:gpt-x"]);
    const stdout = Buffer.from(result.stdout).toString("utf8");

    expect(result.exitCode).toBe(1);

    const payload = JSON.parse(stdout) as { error: string };
    expect(payload.error).toContain("Unsupported LLM provider: foo");

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("run --json accepts explicit provider:model", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixtureFile, validDoc);

    const result = runCli(["run", fixtureFile, "--dry-run", "--json", "--llm", "openai:gpt-4o-mini"]);
    const stdout = Buffer.from(result.stdout).toString("utf8");

    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(stdout) as { success: boolean; cardsTotal: number };
    expect(typeof payload.success).toBe("boolean");
    expect(payload.cardsTotal).toBeGreaterThan(0);

    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
