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
} from "../types/index.js";
import { createMacDriver } from "../drivers/mac/index.js";
import { createProvider } from "../providers/index.js";
import { saveScreenshotToFile } from "../drivers/mac/screenshot.js";
import { getDb, logAction, createSession, updateSession } from "../db/index.js";

const DEFAULT_MAX_STEPS = 50;

/**
 * Run a computer use task. This is the core agent loop:
 * screenshot → AI model → action → repeat until done or max steps.
 */
export async function runTask(options: RunOptions): Promise<Session> {
  const {
    task,
    provider: providerName = "anthropic",
    model,
    maxSteps = DEFAULT_MAX_STEPS,
    saveScreenshots = false,
    screenshotsDir,
    systemPrompt,
    onStep,
    onDone,
  } = options;

  // Initialize driver and provider
  const driver = createMacDriver();
  const provider = createProvider(providerName, { model });

  // Create session
  const sessionId = randomUUID();
  const session: Session = {
    id: sessionId,
    task,
    provider: providerName,
    model: model ?? (providerName === "anthropic" ? "claude-sonnet-4-5-20250514" : "computer-use-preview"),
    status: "running",
    steps: 0,
    total_tokens_in: 0,
    total_tokens_out: 0,
    total_duration_ms: 0,
    created_at: new Date().toISOString(),
  };

  // Save session to DB
  await createSession(session);

  // Screenshots dir
  const ssDir = screenshotsDir ?? `${process.env.HOME}/.hasna/computer/screenshots/${sessionId}`;
  if (saveScreenshots) {
    await mkdir(ssDir, { recursive: true });
  }

  const history: ModelResponse[] = [];
  const startTime = Date.now();

  try {
    for (let step = 0; step < maxSteps; step++) {
      // 1. Take screenshot
      const screenshot = await driver.screenshot();

      // Save screenshot if requested
      let screenshotPath: string | undefined;
      if (saveScreenshots) {
        screenshotPath = await saveScreenshotToFile(
          screenshot,
          ssDir,
          `step-${String(step).padStart(3, "0")}.png`
        );
      }

      // 2. Send to AI model
      const response = await provider.analyze({
        task,
        screenshot,
        history,
        systemPrompt,
      });

      // Track tokens
      if (response.usage) {
        session.total_tokens_in += response.usage.input;
        session.total_tokens_out += response.usage.output;
      }

      // 3. Check if done
      if (response.done || !response.action) {
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

        await updateSession(session);
        onStep?.(step, response, { success: true, duration_ms: 0 });
        onDone?.(session);
        await driver.dispose();
        return session;
      }

      // 4. Execute the action
      const result = await driver.execute(response.action);

      // 5. Log to DB
      await logAction({
        session_id: sessionId,
        step,
        action: response.action,
        reasoning: response.reasoning,
        screenshot_path: screenshotPath,
        success: result.success,
        error: result.error,
        duration_ms: result.duration_ms,
        tokens_in: response.usage?.input,
        tokens_out: response.usage?.output,
      });

      // 6. Add to history
      history.push(response);
      session.steps = step + 1;

      // 7. Notify
      onStep?.(step, response, result);

      // 8. Handle failure
      if (!result.success) {
        // Don't abort on single failure — let the model try to recover
        history.push({
          action: null,
          reasoning: `Action failed: ${result.error}`,
          done: false,
        });
      }
    }

    // Max steps reached
    session.status = "completed";
    session.total_duration_ms = Date.now() - startTime;
    session.completed_at = new Date().toISOString();
    session.error = `Reached max steps (${maxSteps})`;
    await updateSession(session);
    onDone?.(session);
    await driver.dispose();
    return session;
  } catch (err) {
    session.status = "failed";
    session.error = err instanceof Error ? err.message : String(err);
    session.total_duration_ms = Date.now() - startTime;
    session.completed_at = new Date().toISOString();
    await updateSession(session);
    onDone?.(session);
    await driver.dispose();
    return session;
  }
}
