import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";

type CliCapture = {
  stdout: string;
  stderr: string;
  exitCode: string | number | null | undefined;
};

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

async function captureCli(args: string[]): Promise<CliCapture> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  process.exitCode = 0;
  console.log = (...values: unknown[]) => {
    stdout.push(values.map(String).join(" "));
  };
  console.error = (...values: unknown[]) => {
    stderr.push(values.map(String).join(" "));
  };
  console.warn = (...values: unknown[]) => {
    stderr.push(values.map(String).join(" "));
  };
  try {
    await runCli(args);
    return {
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
      exitCode: process.exitCode,
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    process.exitCode = 0;
  }
}

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  console.warn = originalWarn;
  process.exitCode = 0;
});

describe("CLI compact output", () => {
  test("smoke is compact by default and does not dump the decision object", async () => {
    const result = await captureCli(["smoke", "--config", "router.config.example.json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.length).toBeLessThan(1_000);
    expect(result.stdout).toContain("smoke ok: selected");
    expect(result.stdout).toContain("details: use --verbose");
    expect(result.stdout).not.toContain("\"orderedCandidates\"");
    expect(result.stdout).not.toContain("\"policy\"");
  });

  test("smoke --json keeps the full machine-readable decision", async () => {
    const result = await captureCli(["smoke", "--config", "router.config.example.json", "--json"]);
    const body = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(body.status).toBe("selected");
    expect(Array.isArray(body.orderedCandidates)).toBe(true);
    expect(Array.isArray(body.scores)).toBe(true);
    expect(result.stdout).toContain("\"orderedCandidates\"");
    expect(result.stdout.length).toBeGreaterThan(1_000);
  });

  test("smoke --compact is an explicit alias for compact default output", async () => {
    const result = await captureCli(["smoke", "--config", "router.config.example.json", "--compact"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeLessThan(1_000);
    expect(result.stdout).toContain("smoke ok: selected");
    expect(result.stdout).not.toContain("\"orderedCandidates\"");
  });

  test("analyze is compact by default and keeps JSON behind --json", async () => {
    const prompt = "Implement a retry helper in TypeScript and return JSON tests.";
    const compact = await captureCli(["analyze", "--prompt", prompt]);
    const json = await captureCli(["analyze", "--prompt", prompt, "--json"]);
    const body = JSON.parse(json.stdout) as Record<string, unknown>;

    expect(compact.stdout).toContain("task=");
    expect(compact.stdout).toContain("details: use --verbose");
    expect(compact.stdout.trim().startsWith("{")).toBe(false);
    expect(body.primaryTask).toBe("json");
    expect(Array.isArray(body.taskTypes)).toBe(true);
  });

  test("route --json keeps the full machine-readable decision", async () => {
    const result = await captureCli([
      "route",
      "--config",
      "router.config.example.json",
      "--prompt",
      "Implement a retry helper in TypeScript and return JSON tests.",
      "--json",
    ]);
    const body = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.exitCode).toBe(0);
    expect(body.status).toBe("selected");
    expect(body.selectedId).toBe("openai/gpt-4o-mini");
    expect(Array.isArray(body.orderedCandidates)).toBe(true);
    expect(result.stdout).toContain("\"policy\"");
  });

  test("inspect uses verbose human output and honors --limit", async () => {
    const result = await captureCli([
      "inspect",
      "--config",
      "router.config.example.json",
      "--prompt",
      "Implement a retry helper in TypeScript and return JSON tests.",
      "--limit",
      "1",
    ]);

    const scoreRows = result.stdout.split("\n").filter((line) => /^  \d+\./.test(line));
    expect(result.stdout).toContain("scores (top 1");
    expect(result.stdout).toContain("(+2 more)");
    expect(scoreRows).toHaveLength(1);
    expect(result.stdout).not.toContain("\"orderedCandidates\"");
  });

  test("unknown flags fail instead of silently no-oping", async () => {
    const result = await captureCli(["smoke", "--config", "router.config.example.json", "--details"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown flag for smoke: --details");
  });
});
