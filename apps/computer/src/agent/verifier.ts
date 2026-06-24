import { Output, generateText, type LanguageModel } from "ai";
import { z } from "zod/v4";
import { logAuditEvent, recordModelUsage } from "../db/index.js";
import {
  addObservation,
  recordPolicyDecision,
} from "./runtime.js";
import type {
  GoalVerifier,
  GoalVerifierContext,
  VerifierDecision,
  VerifierEvidence,
} from "../types/index.js";
import { buildVerifierSystemPrompt, promptReference } from "./prompts.js";

export const verifierEvidenceSchema = z.object({
  kind: z.enum([
    "screenshot",
    "accessibility_tree",
    "browser_snapshot",
    "terminal_transcript",
    "fleet_status",
    "log",
    "note",
  ]),
  summary: z.string().min(1).max(2_000),
  artifactPath: z.string().min(1).max(1_000).optional(),
  data: z.unknown().optional(),
}).strict();

export const verifierDecisionSchema = z.object({
  status: z.enum(["done", "needs_more_steps", "blocked"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(2_000),
  evidence: z.array(z.string().min(1).max(500)).min(1).max(20),
  nextStep: z.string().min(1).max(1_000).optional(),
}).strict();

export interface VerifyGoalStateOptions extends GoalVerifierContext {
  model?: LanguageModel;
  generator?: GoalVerifier;
  actor?: string;
  transport?: string;
  metadata?: Record<string, unknown>;
  modelName?: string;
  provider?: string;
}

export async function verifyGoalState(options: VerifyGoalStateOptions): Promise<VerifierDecision> {
  const evidence = z.array(verifierEvidenceSchema).min(1).parse(options.evidence);
  const generated = await generateVerifierDecision({
    ...options,
    evidence,
  });
  const decision = verifierDecisionSchema.parse(generated.decision);

  if (options.runId && generated.usage) {
    recordModelUsage({
      runId: options.runId,
      phase: "verifier",
      provider: options.provider ?? "ai-sdk",
      model: options.modelName ?? inferAiSdkModelName(options.model),
      inputTokens: generated.usage.inputTokens ?? 0,
      outputTokens: generated.usage.outputTokens ?? 0,
      metadata: {
        prompt: promptReference("verifier"),
        step_id: options.stepId,
        step_index: options.stepIndex,
        ...options.metadata,
      },
    });
  }

  if (options.runId) {
    addObservation({
      runId: options.runId,
      stepId: options.stepId,
      kind: "verifier_decision",
      data: {
        status: decision.status,
        confidence: decision.confidence,
        reason: decision.reason,
        evidence: decision.evidence,
        next_step: decision.nextStep,
        criteria: options.criteria,
        prompt: promptReference("verifier"),
      },
    });
    recordPolicyDecision({
      runId: options.runId,
      capability: "verifier.goal",
      decision: decision.status,
      reason: decision.reason,
      metadata: {
        confidence: decision.confidence,
        evidence_count: decision.evidence.length,
        step_id: options.stepId,
        step_index: options.stepIndex,
        prompt: promptReference("verifier"),
        ...options.metadata,
      },
    });
  }

  await logAuditEvent({
    event: "verifier.decision",
    actor: options.actor,
    transport: options.transport ?? "verifier",
    capability: "verifier.goal",
    action_type: "goal_verification",
    action_data: {
      run_id: options.runId,
      step_id: options.stepId,
      step_index: options.stepIndex,
      evidence_count: evidence.length,
      redacted: true,
    },
    decision: decision.status,
    reason: decision.reason,
    metadata: {
      confidence: decision.confidence,
      has_next_step: Boolean(decision.nextStep),
      prompt: promptReference("verifier"),
      ...options.metadata,
    },
  });

  return decision;
}

async function generateVerifierDecision(options: VerifyGoalStateOptions): Promise<{ decision: VerifierDecision; usage?: import("ai").LanguageModelUsage }> {
  if (options.generator) {
    return { decision: await options.generator({
      task: options.task,
      runId: options.runId,
      stepId: options.stepId,
      stepIndex: options.stepIndex,
      criteria: options.criteria,
      evidence: options.evidence,
    }) };
  }

  if (options.model) {
    const result = await generateText({
      model: options.model,
      output: Output.object({
        schema: verifierDecisionSchema,
        name: "open_computer_verifier_decision",
        description: "Verifier decision for an open-computer run.",
      }),
      system: buildVerifierSystemPrompt({ criteria: options.criteria }),
      prompt: buildVerifierPrompt(options.task, options.evidence),
    });
    return { decision: verifierDecisionSchema.parse(result.output), usage: result.usage };
  }

  return { decision: fallbackVerifierDecision(options.task, options.evidence) };
}

function buildVerifierPrompt(task: string, evidence: VerifierEvidence[]): string {
  return [
    `Task: ${task}`,
    "Evidence:",
    ...evidence.map((item, index) => `${index + 1}. ${item.kind}: ${item.summary}${item.artifactPath ? ` (${item.artifactPath})` : ""}`),
  ].join("\n");
}

function fallbackVerifierDecision(task: string, evidence: VerifierEvidence[]): VerifierDecision {
  const text = `${task}\n${evidence.map((item) => item.summary).join("\n")}`.toLowerCase();
  const done = /\b(done|completed|success|verified|finished)\b/.test(text);
  return done
    ? {
      status: "done",
      confidence: 0.6,
      reason: "Fallback verifier found completion language in the evidence.",
      evidence: evidence.slice(0, 3).map((item) => item.summary),
    }
    : {
      status: "needs_more_steps",
      confidence: 0.4,
      reason: "Fallback verifier did not find direct completion evidence.",
      evidence: evidence.slice(0, 3).map((item) => item.summary),
      nextStep: "Gather another observation or continue the planned workflow.",
    };
}

function inferAiSdkModelName(model: LanguageModel | undefined): string {
  return typeof model === "string" ? model : "ai-sdk-model";
}
