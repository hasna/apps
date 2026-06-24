import { randomUUID } from "crypto";
import { mkdir } from "fs/promises";
import type {
  ComputerDriver,
  ComputerProvider,
  ModelResponse,
  ActionResult,
  Session,
  RunOptions,
  Provider,
  VerifierEvidence,
  ProviderSafetyCheck,
} from "../types/index.js";
import { createMacDriver } from "../drivers/mac/index.js";
import { createProvider } from "../providers/index.js";
import { saveScreenshotToFile } from "../drivers/mac/screenshot.js";
import { scaleScreenshot } from "../lib/scale.js";
import { coordinateSpaceFromScreenshot, mapActionBetweenSpaces } from "../lib/coordinates.js";
import { loadConfig } from "../lib/config.js";
import { evaluateComputerAction, formatPolicyRejection, recordActionPolicyAudit } from "./policy.js";
import {
  clearSessionCancellation,
  getRunControlDecision,
  registerSessionAbortController,
  resumeSession as resumeSessionControl,
  unregisterSessionAbortController,
  type RunControlDecision,
} from "./control.js";
import { screenshotsMatch } from "../lib/diff.js";
import { logAction, createSession, updateSession, getActionLogs, getSession, recordModelUsage } from "../db/index.js";
import { runPostSessionIntegrations } from "../lib/integrations.js";
import { verifyGoalState } from "./verifier.js";
import { buildExecutorSystemPrompt, promptReference, promptReferences } from "./prompts.js";
import {
  acquireRuntimeLease,
  addObservation,
  addRunStep,
  createRuntimeGoal,
  createWorkflowRun,
  getWorkflowRun,
  createApproval,
  recordArtifact,
  recordPolicyDecision,
  releaseRuntimeLease,
  transitionWorkflowRun,
  type RuntimeLease,
  type WorkflowRun,
} from "./runtime.js";

const DEFAULT_MAX_STEPS = 50;
const DISPLAY_LEASE_TTL_MS = 15 * 60 * 1000;

export async function resumeTask(sessionId: string, options: Omit<RunOptions, "task" | "resumeSessionId"> = {}): Promise<Session> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.status !== "paused") {
    throw new Error(`Only paused sessions can be resumed; ${sessionId} is ${session.status}`);
  }
  resumeSessionControl(sessionId);
  return runTask({
    ...options,
    task: session.task,
    provider: options.provider ?? session.provider,
    model: options.model ?? session.model,
    tags: options.tags ?? session.tags,
    resumeSessionId: session.id,
  });
}

/**
 * Run a computer use task. This is the core agent loop:
 * screenshot → AI model → action → repeat until done or max steps.
 */
export async function runTask(options: RunOptions): Promise<Session> {
  const resumeSessionId = options.resumeSessionId;
  const existingSession = resumeSessionId ? getSession(resumeSessionId) : null;
  if (resumeSessionId && !existingSession) {
    throw new Error(`Session not found: ${resumeSessionId}`);
  }
  if (existingSession && isTerminalSessionStatus(existingSession.status)) {
    throw new Error(`Cannot resume terminal session ${resumeSessionId}: ${existingSession.status}`);
  }

  const {
    model,
    fallbackProvider,
    fallbackModel,
    fallbackOn,
    maxSteps = DEFAULT_MAX_STEPS,
    saveScreenshots = false,
    screenshotsDir,
    systemPrompt,
    verifier,
    verificationCriteria,
    screenshotMaxWidth,
    dryRun = false,
    tags,
    displayNumber,
    onStep,
    onDone,
    driver: providedDriver,
    computerProvider: providedProvider,
    safety: providedSafety,
  } = options;
  const task = existingSession?.task ?? options.task;
  const providerName = options.provider ?? existingSession?.provider ?? providedProvider?.name ?? "anthropic";

  // Initialize driver, provider, and safety config
  const driver = providedDriver ?? createMacDriver({ displayNumber });
  const config = loadConfig();
  const providerFallback = fallbackProvider === false
    ? { ...config.providerFallback, enabled: false }
    : fallbackProvider
      ? {
        enabled: true,
        provider: fallbackProvider,
        model: fallbackModel,
        fallbackOn: fallbackOn ?? config.providerFallback.fallbackOn,
      }
      : config.providerFallback;
  const provider = providedProvider ?? createProvider(providerName, { model, fallback: providerFallback });
  const safetyConfig = providedSafety ?? config.safety;

  // Create session
  const sessionId = existingSession?.id ?? randomUUID();
  const sessionAbortSignal = registerSessionAbortController(sessionId);
  const runtimeGoal = existingSession ? null : createRuntimeGoal({ title: task.slice(0, 160), prompt: task });
  let runtimeRun: WorkflowRun | null = existingSession
    ? getWorkflowRun(sessionId) ?? createWorkflowRun({ id: sessionId, status: "running" })
    : createWorkflowRun({ id: sessionId, goalId: runtimeGoal!.id });
  let displayLease: RuntimeLease | null = null;
  const session: Session = existingSession
    ? {
      ...existingSession,
      provider: providerName,
      model: model ?? existingSession.model,
      status: "running",
      tags: tags ?? existingSession.tags,
      error: undefined,
      completed_at: undefined,
    }
    : {
      id: sessionId,
      task,
      provider: providerName,
      model: model ?? (providerName === "anthropic" ? "claude-sonnet-4-5-20250514" : "computer-use-preview"),
      status: "running",
      tags,
      steps: 0,
      total_tokens_in: 0,
      total_tokens_out: 0,
      total_duration_ms: 0,
      created_at: new Date().toISOString(),
    };

  const history: ModelResponse[] = existingSession ? historyFromActionLogs(sessionId) : [];
  const startTime = Date.now();

  const stopForRunControl = async (decision: RunControlDecision, steps: number): Promise<Session> => {
    const paused = decision.status === "paused";
    session.status = paused ? "paused" : "cancelled";
    session.steps = steps;
    session.error = decision.reason;
    session.total_duration_ms = Date.now() - startTime;
    session.completed_at = paused ? undefined : new Date().toISOString();
    await updateSession(session);
    runtimeRun = transitionWorkflowRun(sessionId, session.status, { error: session.error });
    if (displayLease) releaseRuntimeLease(displayLease.id, { runId: sessionId, holder: "agent-loop" });
    await driver.dispose();
    if (paused) unregisterSessionAbortController(sessionId);
    else clearSessionCancellation(sessionId);
    onDone?.(session);
    return session;
  };

  try {
    // Save session to DB and acquire exclusive display control before observing.
    if (existingSession) await updateSession(session);
    else await createSession(session);
    runtimeRun = transitionWorkflowRun(sessionId, "running");
    addObservation({
      runId: sessionId,
      kind: "prompt_metadata",
      data: {
        prompts: promptReferences("executor", "verifier", "safety_reviewer"),
        operator_system_prompt_override: Boolean(systemPrompt),
      },
    });
    displayLease = acquireRuntimeLease({
      resourceType: "computer_display",
      resourceId: `local:${displayNumber ?? "main"}`,
      runId: sessionId,
      holder: "agent-loop",
      ttlMs: DISPLAY_LEASE_TTL_MS,
    });

    // Screenshots dir
    const ssDir = screenshotsDir ?? `${process.env.HOME}/.hasna/computer/screenshots/${sessionId}`;
    if (saveScreenshots) {
      await mkdir(ssDir, { recursive: true });
    }

    for (let step = session.steps; step < maxSteps; step++) {
      displayLease = acquireRuntimeLease({
        resourceType: "computer_display",
        resourceId: `local:${displayNumber ?? "main"}`,
        runId: sessionId,
        holder: "agent-loop",
        ttlMs: DISPLAY_LEASE_TTL_MS,
      });
      const controlDecision = getRunControlDecision(sessionId);
      if (!controlDecision.allowed) {
        return stopForRunControl(controlDecision, step);
      }

      // 1. Take screenshot
      const screenshot = await driver.screenshot();
      addObservation({
        runId: sessionId,
        kind: "screenshot",
        data: { step, width: screenshot.size.width, height: screenshot.size.height, timestamp: screenshot.timestamp },
      });

      // Save screenshot if requested
      let screenshotPath: string | undefined;
      if (saveScreenshots) {
        screenshotPath = await saveScreenshotToFile(
          screenshot,
          ssDir,
          `step-${String(step).padStart(3, "0")}.png`
        );
        recordArtifact({
          runId: sessionId,
          kind: "screenshot",
          path: screenshotPath,
          metadata: { step, width: screenshot.size.width, height: screenshot.size.height },
        });
      }

      // 2. Scale screenshot for the AI model (Anthropic recommends ≤ WXGA)
      const scaledScreenshot = await scaleScreenshot(screenshot, screenshotMaxWidth);

      // 3. Send to AI model (uses scaled screenshot)
      const response = await provider.analyze({
        task,
        screenshot: scaledScreenshot,
        history,
        systemPrompt: systemPrompt ?? buildExecutorSystemPrompt({ screenSize: scaledScreenshot.size }),
      });

      const postAnalyzeControl = getRunControlDecision(sessionId);
      if (!postAnalyzeControl.allowed) {
        return stopForRunControl(postAnalyzeControl, step);
      }

      const executionResponse: ModelResponse = response.action
        ? {
          ...response,
          action: mapActionBetweenSpaces(
            response.action,
            coordinateSpaceFromScreenshot(scaledScreenshot, "scaled_screenshot"),
            coordinateSpaceFromScreenshot(screenshot, "native_display"),
            { clamp: true },
          ),
        }
        : response;

      // Track tokens
      if (response.usage) {
        session.total_tokens_in += response.usage.input;
        session.total_tokens_out += response.usage.output;
        recordModelUsage({
          runId: sessionId,
          sessionId,
          phase: "executor",
          provider: providerName,
          model: session.model,
          inputTokens: response.usage.input,
          outputTokens: response.usage.output,
          metadata: {
            step,
            provider_native: true,
            dry_run: dryRun,
          },
        });
      }

      if (response.pendingSafetyChecks?.length) {
        const reason = formatPendingSafetyChecks(response.pendingSafetyChecks);
        await logAction({
          session_id: sessionId,
          step,
          action: { type: "screenshot" },
          reasoning: response.reasoning,
          screenshot_path: screenshotPath,
          success: false,
          error: reason,
          duration_ms: 0,
          tokens_in: response.usage?.input,
          tokens_out: response.usage?.output,
        });
        addRunStep({
          runId: sessionId,
          stepIndex: step,
          status: "waiting_on_approval",
          action: { type: "provider_safety_check", checks: response.pendingSafetyChecks },
          result: {
            success: false,
            provider_safety_checks: response.pendingSafetyChecks,
            error: reason,
          },
        });
        for (const check of response.pendingSafetyChecks) {
          createApproval({
            runId: sessionId,
            capability: `${check.provider}.safety_check`,
            reason: formatPendingSafetyCheck(check),
          });
        }
        recordPolicyDecision({
          runId: sessionId,
          capability: `${response.pendingSafetyChecks[0]!.provider}.safety_check`,
          decision: "requires_confirmation",
          reason,
          metadata: {
            step,
            provider_safety_checks: response.pendingSafetyChecks,
            prompt: promptReference("safety_reviewer"),
          },
        });
        session.status = "waiting_on_approval";
        session.steps = step + 1;
        session.total_duration_ms = Date.now() - startTime;
        await updateSession(session);
        runtimeRun = transitionWorkflowRun(sessionId, "waiting_on_approval");
        onStep?.(step, response, { success: false, error: reason, duration_ms: 0 });
        onDone?.(session);
        if (displayLease) releaseRuntimeLease(displayLease.id, { runId: sessionId, holder: "agent-loop" });
        await driver.dispose();
        unregisterSessionAbortController(sessionId);
        return session;
      }

      // 5. Check if done
      if (response.done || !executionResponse.action) {
        if (verifier) {
          const verification = await verifyGoalState({
            task,
            runId: sessionId,
            stepIndex: step,
            criteria: verificationCriteria,
            evidence: buildVerifierEvidence({
              step,
              screenshot,
              screenshotPath,
              reasoning: response.reasoning,
            }),
            generator: verifier,
            transport: "agent",
            metadata: {
              provider: providerName,
              dry_run: dryRun,
              prompt: promptReference("verifier"),
            },
          });

          if (verification.status === "needs_more_steps" && step + 1 < maxSteps) {
            const verifierReasoning = `VERIFIER requested another step: ${verification.reason}`;
            history.push({
              action: null,
              reasoning: `${verifierReasoning}${verification.nextStep ? ` Next: ${verification.nextStep}` : ""}`,
              done: false,
            });
            await logAction({
              session_id: sessionId,
              step,
              action: { type: "screenshot" },
              reasoning: `${response.reasoning}\n${verifierReasoning}`,
              screenshot_path: screenshotPath,
              success: true,
              duration_ms: 0,
              tokens_in: response.usage?.input,
              tokens_out: response.usage?.output,
            });
            addRunStep({
              runId: sessionId,
              stepIndex: step,
              status: "completed",
              action: { type: "screenshot" },
              result: {
                success: true,
                done: false,
                verifier_status: verification.status,
                verifier_reason: verification.reason,
                next_step: verification.nextStep,
              },
            });
            recordPolicyDecision({
              runId: sessionId,
              capability: "computer.continue",
              decision: "verifier_requested_more_steps",
              reason: verification.reason,
              metadata: { step, prompt: promptReference("verifier") },
            });
            session.steps = step + 1;
            onStep?.(step, executionResponse, { success: true, duration_ms: 0 });
            continue;
          }

          if (verification.status === "blocked") {
            session.status = "failed";
            session.steps = step + 1;
            session.error = `Verifier blocked completion: ${verification.reason}`;
            session.total_duration_ms = Date.now() - startTime;
            session.completed_at = new Date().toISOString();
            await logAction({
              session_id: sessionId,
              step,
              action: { type: "screenshot" },
              reasoning: `${response.reasoning}\nVERIFIER blocked completion: ${verification.reason}`,
              screenshot_path: screenshotPath,
              success: false,
              error: session.error,
              duration_ms: 0,
              tokens_in: response.usage?.input,
              tokens_out: response.usage?.output,
            });
            addRunStep({
              runId: sessionId,
              stepIndex: step,
              status: "failed",
              action: { type: "screenshot" },
              result: { success: false, done: false, verifier_status: verification.status, error: session.error },
            });
            await updateSession(session);
            runtimeRun = transitionWorkflowRun(sessionId, "failed", { error: session.error });
            onStep?.(step, executionResponse, { success: false, error: session.error, duration_ms: 0 });
            const logs = getActionLogs(sessionId);
            await runPostSessionIntegrations(session, logs).catch(() => {});
            onDone?.(session);
            if (displayLease) releaseRuntimeLease(displayLease.id, { runId: sessionId, holder: "agent-loop" });
            await driver.dispose();
            clearSessionCancellation(sessionId);
            return session;
          }
        }

        session.status = "completed";
        session.steps = step + 1;
        session.total_duration_ms = Date.now() - startTime;
        session.completed_at = new Date().toISOString();

        await logAction({
          session_id: sessionId,
          step,
          action: { type: "screenshot" },
          reasoning: response.reasoning,
          screenshot_path: screenshotPath,
          success: true,
          duration_ms: 0,
          tokens_in: response.usage?.input,
          tokens_out: response.usage?.output,
        });
        addRunStep({
          runId: sessionId,
          stepIndex: step,
          status: "completed",
          action: { type: "screenshot" },
          result: { success: true, done: true },
        });
        recordPolicyDecision({
          runId: sessionId,
          capability: "computer.complete",
          decision: "completed",
          metadata: {
            step,
            prompts: verifier
              ? promptReferences("executor", "verifier")
              : promptReferences("executor"),
          },
        });

        await updateSession(session);
        runtimeRun = transitionWorkflowRun(sessionId, "completed");
        onStep?.(step, executionResponse, { success: true, duration_ms: 0 });
        // Run optional ecosystem integrations
        const logs = getActionLogs(sessionId);
        await runPostSessionIntegrations(session, logs).catch(() => {});
        onDone?.(session);
        if (displayLease) releaseRuntimeLease(displayLease.id, { runId: sessionId, holder: "agent-loop" });
        await driver.dispose();
        clearSessionCancellation(sessionId);
        return session;
      }

      // 4. Safety check before executing
      const action = executionResponse.action;
      const policyDecision = evaluateComputerAction(action, { safety: safetyConfig, sessionId });
      await recordActionPolicyAudit(action, policyDecision, {
        transport: "agent",
        capability: `computer.${action.type}`,
        metadata: {
          session_id: sessionId,
          step,
          provider: providerName,
          dry_run: dryRun,
          prompts: promptReferences("executor", "safety_reviewer"),
        },
      });
      if (!policyDecision.allowed) {
        const rejection = formatPolicyRejection(policyDecision);
        // Action blocked by safety layer — tell the model
        history.push({
          action: null,
          reasoning: `BLOCKED by safety: ${rejection}`,
          done: false,
        });
        await logAction({
          session_id: sessionId,
          step,
          action,
          reasoning: `BLOCKED: ${rejection}`,
          screenshot_path: screenshotPath,
          success: false,
          error: rejection,
          duration_ms: 0,
          tokens_in: response.usage?.input,
          tokens_out: response.usage?.output,
        });
        addRunStep({
          runId: sessionId,
          stepIndex: step,
          status: policyDecision.status === "requires_confirmation" ? "waiting_on_approval" : "failed",
          action,
          result: { success: false, error: rejection, policy_status: policyDecision.status },
        });
        recordPolicyDecision({
          runId: sessionId,
          capability: `computer.${action.type}`,
          decision: policyDecision.status,
          reason: policyDecision.reason,
          metadata: { step, prompt: promptReference("safety_reviewer") },
        });
        if (policyDecision.status === "requires_confirmation") {
          createApproval({
            runId: sessionId,
            capability: `computer.${action.type}`,
            reason: policyDecision.reason,
          });
          session.status = "waiting_on_approval";
          session.steps = step + 1;
          session.total_duration_ms = Date.now() - startTime;
          await updateSession(session);
          runtimeRun = transitionWorkflowRun(sessionId, "waiting_on_approval");
          onStep?.(step, executionResponse, { success: false, error: rejection, duration_ms: 0 });
          onDone?.(session);
          if (displayLease) releaseRuntimeLease(displayLease.id, { runId: sessionId, holder: "agent-loop" });
          await driver.dispose();
          return session;
        }
        onStep?.(step, executionResponse, { success: false, error: rejection, duration_ms: 0 });
        session.steps = step + 1;
        continue;
      }

      // 5. Execute the action (or simulate in dry-run mode)
      const preExecuteControl = getRunControlDecision(sessionId);
      if (!preExecuteControl.allowed) {
        return stopForRunControl(preExecuteControl, preExecuteControl.status === "paused" ? step : step + 1);
      }

      const result = dryRun
        ? { success: true, duration_ms: 0 } as ActionResult
        : await driver.execute(action, { signal: sessionAbortSignal });

      // 6. Log to DB
      await logAction({
        session_id: sessionId,
        step,
        action,
        reasoning: response.reasoning,
        screenshot_path: screenshotPath,
        success: result.success,
        error: result.error,
        duration_ms: result.duration_ms,
        tokens_in: response.usage?.input,
        tokens_out: response.usage?.output,
      });
      addRunStep({
        runId: sessionId,
        stepIndex: step,
        status: result.success ? "completed" : "failed",
        action,
        result,
      });
      recordPolicyDecision({
        runId: sessionId,
        capability: `computer.${action.type}`,
        decision: result.success ? "succeeded" : "failed",
        reason: result.error,
        metadata: { step, dry_run: dryRun, prompt: promptReference("executor") },
      });

      const postExecuteControl = getRunControlDecision(sessionId);
      if (!postExecuteControl.allowed) {
        return stopForRunControl(postExecuteControl, step + 1);
      }

      // 6. Add to history
      history.push(response);
      session.steps = step + 1;

      // 7. Notify
      onStep?.(step, executionResponse, result);

      // 8. Handle failure
      if (!result.success) {
        // Don't abort on single failure — let the model try to recover
        history.push({
          action: null,
          reasoning: `Action failed: ${result.error}`,
          done: false,
        });
      }

      // 9. Screenshot diff — detect if screen didn't change after action
      if (!dryRun && result.screenshot && action.type !== "screenshot") {
        if (screenshotsMatch(screenshot, result.screenshot)) {
          history.push({
            action: null,
            reasoning: "NOTE: The screen did not visibly change after your action. It may not have worked, or the UI may need more time to update. Consider waiting or trying a different approach.",
            done: false,
          });
        }
      }
    }

    // Max steps reached
    session.status = "max_steps_exceeded";
    session.total_duration_ms = Date.now() - startTime;
    session.completed_at = new Date().toISOString();
    session.error = `Reached max steps (${maxSteps})`;
    await updateSession(session);
    runtimeRun = transitionWorkflowRun(sessionId, "max_steps_exceeded", { error: session.error });
    const endLogs = getActionLogs(sessionId);
    await runPostSessionIntegrations(session, endLogs).catch(() => {});
    onDone?.(session);
    if (displayLease) releaseRuntimeLease(displayLease.id, { runId: sessionId, holder: "agent-loop" });
    await driver.dispose();
    clearSessionCancellation(sessionId);
    return session;
  } catch (err) {
    session.status = "failed";
    session.error = err instanceof Error ? err.message : String(err);
    session.total_duration_ms = Date.now() - startTime;
    session.completed_at = new Date().toISOString();
    await updateSession(session);
    if (runtimeRun && runtimeRun.status !== "failed" && runtimeRun.status !== "cancelled" && runtimeRun.status !== "completed" && runtimeRun.status !== "max_steps_exceeded") {
      runtimeRun = transitionWorkflowRun(sessionId, "failed", { error: session.error });
    }
    const errLogs = getActionLogs(sessionId);
    await runPostSessionIntegrations(session, errLogs).catch(() => {});
    onDone?.(session);
    if (displayLease) releaseRuntimeLease(displayLease.id, { runId: sessionId, holder: "agent-loop" });
    await driver.dispose();
    clearSessionCancellation(sessionId);
    return session;
  }
}

function buildVerifierEvidence(input: {
  step: number;
  screenshot: import("../types/index.js").Screenshot;
  screenshotPath?: string;
  reasoning?: string;
}): VerifierEvidence[] {
  const evidence: VerifierEvidence[] = [
    {
      kind: "screenshot",
      summary: `Step ${input.step} screenshot ${input.screenshot.size.width}x${input.screenshot.size.height}.`,
      artifactPath: input.screenshotPath,
      data: {
        step: input.step,
        width: input.screenshot.size.width,
        height: input.screenshot.size.height,
        timestamp: input.screenshot.timestamp,
      },
    },
  ];
  if (input.reasoning) {
    evidence.push({
      kind: "log",
      summary: input.reasoning.slice(0, 2_000),
    });
  }
  return evidence;
}

function historyFromActionLogs(sessionId: string): ModelResponse[] {
  return getActionLogs(sessionId).map((log) => ({
    action: log.success ? log.action : null,
    reasoning: log.error ? `${log.reasoning}\nAction failed: ${log.error}` : log.reasoning,
    done: false,
    usage: log.tokens_in !== undefined || log.tokens_out !== undefined
      ? { input: log.tokens_in ?? 0, output: log.tokens_out ?? 0 }
      : undefined,
  }));
}

function formatPendingSafetyChecks(checks: ProviderSafetyCheck[]): string {
  return `Provider safety checks require approval: ${checks.map(formatPendingSafetyCheck).join("; ")}`;
}

function formatPendingSafetyCheck(check: ProviderSafetyCheck): string {
  return `${check.provider}:${check.code ?? "safety_check"}:${check.id}${check.message ? ` - ${check.message}` : ""}`;
}

function isTerminalSessionStatus(status: Session["status"]): boolean {
  return status === "cancelled" || status === "failed" || status === "completed" || status === "max_steps_exceeded";
}
