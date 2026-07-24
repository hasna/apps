import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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

function makeLargeDoc(count: number = 25) {
  const cards = Array.from({ length: count }, (_, index) => `type: custom
id: card-${index}
note: ${index}

Card ${index}.`);
  return `# LargeCli\n\n---\n\n${cards.join("\n\n---\n\n")}`;
}

function runCli(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("omp CLI metadata", () => {
  test("prints the package version", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    const result = runCli(["--version"]);
    const stdout = Buffer.from(result.stdout).toString("utf8").trim();

    expect(result.exitCode).toBe(0);
    expect(stdout).toBe(pkg.version);
  });
});

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

describe("omp CLI compact output", () => {
  test("compile defaults to compact text and keeps --json for full plans", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixtureFile, makeLargeDoc());

    const compact = runCli(["compile", fixtureFile]);
    const compactOut = Buffer.from(compact.stdout).toString("utf8");

    expect(compact.exitCode).toBe(0);
    expect(compactOut).toContain("Execution Plan:");
    expect(compactOut).toContain("Hint: use --verbose");
    expect(compactOut.trim().startsWith("{")).toBe(false);

    const json = runCli(["compile", fixtureFile, "--json"]);
    const payload = JSON.parse(Buffer.from(json.stdout).toString("utf8")) as { steps: unknown[]; totalCards: number };
    expect(json.exitCode).toBe(0);
    expect(Array.isArray(payload.steps)).toBe(true);
    expect(payload.totalCards).toBe(25);

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("inspect caps default rows with --limit and expands with --verbose", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixtureFile, makeLargeDoc());

    const compact = runCli(["inspect", fixtureFile, "--limit", "3"]);
    const compactOut = Buffer.from(compact.stdout).toString("utf8");

    expect(compact.exitCode).toBe(0);
    expect(compactOut).toContain("Cards: 25");
    expect(compactOut).toContain("... 22 more cards not shown");
    expect(compactOut).not.toContain("custom:card-24");

    const verbose = runCli(["inspect", fixtureFile, "--verbose"]);
    const verboseOut = Buffer.from(verbose.stdout).toString("utf8");
    expect(verbose.exitCode).toBe(0);
    expect(verboseOut).toContain("custom:card-24");
    expect(verboseOut).toContain("headers=[note]");

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("rejects invalid compact output limits", () => {
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixtureFile, makeLargeDoc());

    for (const value of ["3abc", "0"]) {
      const result = runCli(["compile", fixtureFile, "--limit", value]);
      const stderr = Buffer.from(result.stderr).toString("utf8");

      expect(result.exitCode).toBe(1);
      expect(stderr).toContain(`Invalid limit value: ${value}`);
    }

    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
