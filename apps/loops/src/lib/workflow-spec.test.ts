import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { workflowBodyFromJson } from "./workflow-spec.js";

describe("workflow goal spec validation", () => {
  test("accepts workflow and step goals during JSON normalization", () => {
    const workflow = workflowBodyFromJson({
      name: "goal-workflow",
      goal: { objective: "complete the whole workflow", tokenBudget: 100, maxTurns: 3 },
      steps: [
        {
          id: "step-one",
          goal: { objective: "complete this step", model: "openai/gpt-4o-mini" },
          target: { type: "command", command: "true" },
        },
      ],
    });

    expect(workflow.goal?.objective).toBe("complete the whole workflow");
    expect(workflow.steps[0]?.goal?.objective).toBe("complete this step");
  });

  test("rejects empty and overlong goals", () => {
    expect(() =>
      workflowBodyFromJson({
        name: "empty-goal",
        goal: { objective: " " },
        steps: [{ id: "step", target: { type: "command", command: "true" } }],
      }),
    ).toThrow("goal.objective");

    expect(() =>
      workflowBodyFromJson({
        name: "long-goal",
        goal: { objective: "x".repeat(4001) },
        steps: [{ id: "step", target: { type: "command", command: "true" } }],
      }),
    ).toThrow("4000");
  });

  test("accepts provider permission and sandbox fields for agent steps", () => {
    const workflow = workflowBodyFromJson({
      name: "agent-target-options",
      steps: [
        {
          id: "worker",
          target: {
            type: "agent",
            provider: "codewith",
            prompt: "do the task",
            permissionMode: "bypass",
            sandbox: "danger-full-access",
            manualBreakGlass: true,
            allowlist: { safetyReason: "operator-approved full access for this isolated test" },
            variant: "low",
          },
        },
        {
          id: "reviewer",
          target: {
            type: "agent",
            provider: "cursor",
            prompt: "review the task",
            permissionMode: "plan",
            sandbox: "enabled",
          },
        },
      ],
    });

    expect(workflow.steps[0]?.target.type).toBe("agent");
    expect(workflow.steps[1]?.target.type).toBe("agent");
  });

  test("requires auditable reasons for declared restrictions and break-glass for relaxed sandboxes", () => {
    expect(() =>
      workflowBodyFromJson({
        name: "missing-restriction-reason",
        steps: [{
          id: "worker",
          target: {
            type: "agent",
            provider: "codewith",
            prompt: "do scoped work",
            sandbox: "workspace-write",
            allowlist: { tools: ["functions.exec_command"], commands: ["git", "bun"] },
          },
        }],
      }),
    ).toThrow("allowlist.safetyReason");

    expect(() =>
      workflowBodyFromJson({
        name: "missing-break-glass",
        steps: [{
          id: "worker",
          target: {
            type: "agent",
            provider: "codewith",
            prompt: "do risky work",
            sandbox: "danger-full-access",
            allowlist: { safetyReason: "operator approved the isolated scope" },
          },
        }],
      }),
    ).toThrow("manualBreakGlass=true");

    const workflow = workflowBodyFromJson({
      name: "auditable-agent-contract",
      steps: [{
        id: "worker",
        target: {
          type: "agent",
          provider: "cursor",
          prompt: "do scoped work",
          cwd: "/tmp/repo",
          sandbox: "disabled",
          manualBreakGlass: true,
          allowlist: {
            tools: [" functions.exec_command "],
            commands: [" git ", "bun"],
            safetyReason: "  isolated worktree requires local provider access  ",
          },
        },
      }],
    });
    const target = workflow.steps[0]?.target;
    if (!target || target.type !== "agent") throw new Error("expected agent target");
    expect(target.manualBreakGlass).toBe(true);
    expect(target.allowlist).toEqual({
      tools: ["functions.exec_command"],
      commands: ["git", "bun"],
      enforcement: "metadata_only",
      safetyReason: "isolated worktree requires local provider access",
    });
  });

  test("accepts explicit unlimited timeoutMs on targets and steps", () => {
    const workflow = workflowBodyFromJson({
      name: "unlimited-timeouts",
      steps: [
        {
          id: "command",
          timeoutMs: null,
          target: { type: "command", command: "true", timeoutMs: null },
        },
        {
          id: "agent",
          timeoutMs: null,
          target: { type: "agent", provider: "codewith", prompt: "do work", timeoutMs: null },
        },
      ],
    });

    expect(workflow.steps[0]?.timeoutMs).toBeNull();
    expect(workflow.steps[0]?.target.timeoutMs).toBeNull();
    expect(workflow.steps[1]?.timeoutMs).toBeNull();
    expect(workflow.steps[1]?.target.timeoutMs).toBeNull();
  });

  test("validates and normalizes opt-in Knowledge feedback target config", () => {
    const workflow = workflowBodyFromJson({
      name: "knowledge-feedback-workflow",
      steps: [
        {
          id: "command",
          target: {
            type: "command",
            command: "true",
            knowledgeFeedback: {
              enabled: true,
              emit: true,
              readContext: false,
              command: " knowledge ",
              store: " /tmp/knowledge ",
              scope: "project",
              maxItems: 4,
              maxTokens: 800,
              timeoutMs: 5_000,
              tags: [" openloops ", " feedback "],
              required: false,
            },
          },
        },
      ],
    });

    expect(workflow.steps[0]?.target.knowledgeFeedback).toEqual({
      enabled: true,
      emit: true,
      readContext: false,
      command: "knowledge",
      store: "/tmp/knowledge",
      scope: "project",
      maxItems: 4,
      maxTokens: 800,
      timeoutMs: 5_000,
      tags: ["openloops", "feedback"],
      required: false,
    });

    expect(() =>
      workflowBodyFromJson({
        name: "invalid-knowledge-scope",
        steps: [{
          id: "worker",
          target: {
            type: "agent",
            provider: "codewith",
            prompt: "work",
            knowledgeFeedback: { enabled: true, scope: "unsafe" },
          },
        }],
      }),
    ).toThrow("knowledgeFeedback.scope");

    expect(() =>
      workflowBodyFromJson({
        name: "invalid-knowledge-budget",
        steps: [{
          id: "worker",
          target: {
            type: "command",
            command: "true",
            knowledgeFeedback: { enabled: true, maxItems: 0 },
          },
        }],
      }),
    ).toThrow("knowledgeFeedback.maxItems");
  });

  test("resolves workflow agent promptFile relative to the workflow file directory", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-workflow-prompt-file-"));
    const promptFile = join(root, "prompts", "worker.md");
    mkdirSync(join(root, "prompts"), { recursive: true });
    writeFileSync(promptFile, "read this prompt from disk\n");

    const workflow = workflowBodyFromJson(
      {
        name: "prompt-file-workflow",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              promptFile: "prompts/worker.md",
            },
          },
        ],
      },
      undefined,
      { baseDir: root },
    );

    const target = workflow.steps[0]?.target;
    expect(target?.type).toBe("agent");
    if (!target || target.type !== "agent") throw new Error("expected agent target");
    expect(target.prompt).toBe("read this prompt from disk\n");
    expect(target.promptSource).toEqual({ type: "file", path: promptFile });
    expect("promptFile" in target).toBe(false);
  });

  test("rejects missing, duplicate, or empty prompt sources and strips spoofed inline promptSource", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-workflow-bad-prompt-file-"));
    const emptyFile = join(root, "empty.md");
    writeFileSync(emptyFile, "  \n");
    const goodFile = join(root, "good.md");
    writeFileSync(goodFile, "hello\n");

    expect(() =>
      workflowBodyFromJson({
        name: "missing-agent-prompt",
        steps: [{ id: "worker", target: { type: "agent", provider: "codewith" } }],
      }),
    ).toThrow("prompt");

    expect(() =>
      workflowBodyFromJson(
        {
          name: "duplicate-agent-prompt",
          steps: [{ id: "worker", target: { type: "agent", provider: "codewith", prompt: "inline", promptFile: "good.md" } }],
        },
        undefined,
        { baseDir: root },
      ),
    ).toThrow("either prompt or promptFile");

    expect(() =>
      workflowBodyFromJson(
        {
          name: "empty-agent-prompt-file",
          steps: [{ id: "worker", target: { type: "agent", provider: "codewith", promptFile: "empty.md" } }],
        },
        undefined,
        { baseDir: root },
      ),
    ).toThrow("non-empty prompt");

    const inline = workflowBodyFromJson({
      name: "spoofed-prompt-source",
      steps: [
        {
          id: "worker",
          target: { type: "agent", provider: "codewith", prompt: "inline", promptSource: { type: "file", path: goodFile } },
        },
      ],
    });
    const target = inline.steps[0]?.target;
    expect(target?.type).toBe("agent");
    if (!target || target.type !== "agent") throw new Error("expected agent target");
    expect(target.prompt).toBe("inline");
    expect(target.promptSource).toBeUndefined();
  });

  test("rejects provider-incompatible permission and sandbox fields", () => {
    expect(() =>
      workflowBodyFromJson({
        name: "bad-opencode-model",
        steps: [
          {
            id: "worker",
            target: { type: "agent", provider: "opencode", prompt: "do it" },
          },
        ],
      }),
    ).toThrow("model is required for provider opencode");

    expect(() =>
      workflowBodyFromJson({
        name: "bad-permission-mode",
        steps: [
          {
            id: "worker",
            target: { type: "agent", provider: "opencode", prompt: "do it", model: "openrouter/google/gemini-2.5-flash", permissionMode: "plan" },
          },
        ],
      }),
    ).toThrow("permissionMode plan");

    expect(() =>
      workflowBodyFromJson({
        name: "bad-sandbox",
        steps: [
          {
            id: "worker",
            target: { type: "agent", provider: "claude", prompt: "do it", sandbox: "danger-full-access" },
          },
        ],
      }),
    ).toThrow("sandbox is currently supported");

    expect(() =>
      workflowBodyFromJson({
        name: "bad-cursor-auto",
        steps: [
          {
            id: "worker",
            target: { type: "agent", provider: "cursor", prompt: "do it", permissionMode: "auto" },
          },
        ],
      }),
    ).toThrow("permissionMode auto");

    expect(() =>
      workflowBodyFromJson({
        name: "bad-variant",
        steps: [
          {
            id: "worker",
            target: { type: "agent", provider: "codewith", prompt: "do it", variant: { effort: "low" } },
          },
        ],
      }),
    ).toThrow("variant");
  });

  test("rejects malformed step-level workflow fields", () => {
    expect(() =>
      workflowBodyFromJson({
        name: "bad-dependencies",
        steps: [
          {
            id: "worker",
            dependsOn: "prepare",
            target: { type: "command", command: "true" },
          },
        ],
      }),
    ).toThrow("dependsOn");

    expect(() =>
      workflowBodyFromJson({
        name: "bad-continue-on-failure",
        steps: [
          {
            id: "worker",
            continueOnFailure: "false",
            target: { type: "command", command: "true" },
          },
        ],
      }),
    ).toThrow("continueOnFailure");

    expect(() =>
      workflowBodyFromJson({
        name: "bad-step-timeout",
        steps: [
          {
            id: "worker",
            timeoutMs: 0,
            target: { type: "command", command: "true" },
          },
        ],
      }),
    ).toThrow("timeoutMs");

    expect(() =>
      workflowBodyFromJson({
        name: "bad-step-account",
        steps: [
          {
            id: "worker",
            account: { tool: "codewith" },
            target: { type: "command", command: "true" },
          },
        ],
      }),
    ).toThrow("account.profile");
  });

  test("rejects invalid agent config isolation", () => {
    expect(() =>
      workflowBodyFromJson({
        name: "bad-config-isolation",
        steps: [
          {
            id: "worker",
            target: { type: "agent", provider: "codewith", prompt: "do it", configIsolation: "sfae" },
          },
        ],
      }),
    ).toThrow("configIsolation");
  });

  test("rejects provider options that would be ignored by adapters", () => {
    expect(() =>
      workflowBodyFromJson({
        name: "bad-cursor-variant",
        steps: [
          {
            id: "worker",
            target: { type: "agent", provider: "cursor", prompt: "do it", variant: "max" },
          },
        ],
      }),
    ).toThrow("variant");

    expect(() =>
      workflowBodyFromJson({
        name: "bad-codex-agent",
        steps: [
          {
            id: "worker",
            target: { type: "agent", provider: "codex", prompt: "do it", agent: "reviewer" },
          },
        ],
      }),
    ).toThrow("agent");

    expect(() =>
      workflowBodyFromJson({
        name: "bad-model-type",
        steps: [
          {
            id: "worker",
            target: { type: "agent", provider: "codewith", prompt: "do it", model: 123 },
          },
        ],
      }),
    ).toThrow("model");

    expect(() =>
      workflowBodyFromJson({
        name: "bad-codewith-ephemeral",
        steps: [
          {
            id: "worker",
            target: { type: "agent", provider: "codewith", prompt: "do it", extraArgs: ["exec", "--ephemeral"] },
          },
        ],
      }),
    ).toThrow("extraArgs");
  });

  test("accepts the transcript feedback workflow fixture", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../../docs/workflows/transcript-feedback-to-loops.json", import.meta.url), "utf8"),
    );

    const workflow = workflowBodyFromJson(fixture);
    const firstTarget = workflow.steps[0]!.target;

    expect(workflow.name).toBe("transcript-feedback-to-loops");
    expect(workflow.goal).toBeUndefined();
    expect(workflow.steps.map((step) => step.id)).toEqual([
      "check-transcriber",
      "check-loops",
      "transcribe-media",
      "extract-loop-backlog",
      "author-loop-workflows",
      "validate-loop-workflows",
    ]);
    expect(firstTarget.type).toBe("command");
    if (firstTarget.type !== "command") throw new Error("expected command target");
    expect(firstTarget.shell).toBeUndefined();
    expect(firstTarget.command).toBe("transcriber");
    const transcribeTarget = workflow.steps.find((step) => step.id === "transcribe-media")?.target;
    expect(transcribeTarget?.type).toBe("command");
    if (!transcribeTarget || transcribeTarget.type !== "command") throw new Error("expected transcribe command target");
    expect(transcribeTarget.env?.TRANSCRIBER_SOURCE_URL).toBeUndefined();
    expect(transcribeTarget.env?.TRANSCRIBER_PROVIDER).toBe("openai");
    expect(transcribeTarget.env?.TRANSCRIBER_MODEL).toBeUndefined();
    expect(transcribeTarget.command).toContain("TRANSCRIBER_SOURCE_URL:?set TRANSCRIBER_SOURCE_URL");
    expect(transcribeTarget.command).toContain("latest-transcript.json");
    expect(transcribeTarget.command).not.toContain("https://example.com");
    expect(transcribeTarget.command).not.toContain("--model");
    const validateTarget = workflow.steps.find((step) => step.id === "validate-loop-workflows")?.target;
    expect(validateTarget?.type).toBe("command");
    if (!validateTarget || validateTarget.type !== "command") throw new Error("expected validation command target");
    expect(validateTarget.command).toContain("--preflight");
    expect(validateTarget.command).toContain("no generated workflow specs found");
    expect(validateTarget.command).toContain("exit 0");
  });
});
