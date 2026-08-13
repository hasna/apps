import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli/index";
import { guardrailsVersion } from "../src";

const paths: string[] = [];
let logs: string[] = [];
let errors: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

async function fixture(name: string, value: unknown): Promise<string> {
  const path = join(tmpdir(), `open-guardrails-cli-${randomUUID()}-${name}.json`);
  paths.push(path);
  await Bun.write(path, JSON.stringify(value));
  return path;
}

beforeEach(() => {
  logs = [];
  errors = [];
  process.exitCode = 0;
  logSpy = spyOn(console, "log").mockImplementation((...values: unknown[]) => logs.push(values.join(" ")));
  errorSpy = spyOn(console, "error").mockImplementation((...values: unknown[]) => errors.push(values.join(" ")));
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  process.exitCode = 0;
});

afterAll(async () => {
  await Promise.all(paths.map((path) => rm(path, { force: true })));
});

describe("CLI", () => {
  test("prints help and version", async () => {
    await runCli([]);
    expect(logs[0]).toContain("Usage:");
    logs = [];
    await runCli(["ignored", "positional", "--help"]);
    expect(logs[0]).toContain("open-guardrails");
    logs = [];
    await runCli(["version", "--first", "--second"]);
    expect(logs).toEqual([guardrailsVersion]);
  });

  test("emits a parseable decision for evaluate --json without leaking placeholder secret text", async () => {
    const rawPlaceholderSecret = "sk-PLACEHOLDER0000";
    const inputPath = await fixture("input", {
      operationType: "prompt",
      prompt: { text: `Use ${rawPlaceholderSecret}` },
    });

    await runCli(["evaluate", "--input", inputPath, "--json"]);

    expect(logs).toHaveLength(1);
    const decision = JSON.parse(logs[0] ?? "") as { status: string; redactions: unknown[] };
    expect(decision.status).toBe("redact");
    expect(decision.redactions).toHaveLength(1);
    expect(logs[0]).not.toContain(rawPlaceholderSecret);
    expect(process.exitCode).toBe(0);
  });

  test("reads evaluate JSON from stdin", async () => {
    const stdinSpy = spyOn(Bun.stdin, "text").mockResolvedValue(
      JSON.stringify({ operationType: "prompt", prompt: { text: "ordinary placeholder" } }),
    );
    try {
      await runCli(["evaluate", "--stdin", "--json"]);
      expect(JSON.parse(logs[0] ?? "").status).toBe("allow");
    } finally {
      stdinSpy.mockRestore();
    }
  });

  test("loads custom policy files and prints human-readable denial details", async () => {
    const inputPath = await fixture("action", {
      operationType: "action",
      action: { name: "placeholder action" },
    });
    const policyPath = await fixture("policy", {
      id: "cli-policy",
      policies: [
        {
          id: "approval",
          effect: "approval_required",
          reason: "Placeholder approval required.",
          approval: { id: "approval-id" },
        },
      ],
    });

    await runCli(["evaluate", "--input", inputPath, "--policy", policyPath]);

    expect(logs).toEqual([
      "approval_required: Placeholder approval required.",
      "matched: approval",
      "approvals: 1",
    ]);
    expect(process.exitCode).toBe(2);
  });

  test("prints redaction counts in human-readable output", async () => {
    const inputPath = await fixture("redaction", {
      operationType: "prompt",
      prompt: { text: "sk-PLACEHOLDER0000" },
    });
    await runCli(["evaluate", "--input", inputPath]);
    expect(logs.at(-1)).toBe("redactions: 1");
  });

  test("validates policy files and reports invalid policies", async () => {
    const validPath = await fixture("valid", { id: "valid", policies: [] });
    await runCli(["validate", "--policy", validPath]);
    expect(logs).toEqual([`Policy ${validPath} is valid.`]);

    logs = [];
    const invalidPath = await fixture("invalid", { id: "invalid", policies: "invalid" });
    await runCli(["validate", "--policy", invalidPath]);
    expect(errors[0]).toContain("policies");
    expect(process.exitCode).toBe(1);
  });

  test("rejects missing required arguments", async () => {
    await expect(runCli(["validate"])).rejects.toThrow("--policy is required");
    await expect(runCli(["evaluate"])).rejects.toThrow("--input is required");
  });

  test("unknown commands show help and fail", async () => {
    await runCli(["unknown"]);
    expect(logs[0]).toContain("Usage:");
    expect(process.exitCode).toBe(1);
  });
});
