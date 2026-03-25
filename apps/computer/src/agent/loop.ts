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
import { scaleScreenshot } from "../lib/scale.js";
import { loadConfig } from "../lib/config.js";
import { checkAction } from "./safety.js";
import { screenshotsMatch } from "../lib/diff.js";
import { logAction, createSession, updateSession, getActionLogs } from "../db/index.js";
import { runPostSessionIntegrations } from "../lib/integrations.js";

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
    screenshotMaxWidth,
    dryRun = false,
    tags,
    displayNumber,
    onStep,
    onDone,
  } = options;

  // Initialize driver, provider, and safety config
  const driver = createMacDriver({ displayNumber });
  const provider = createProvider(providerName, { model });
  const config = loadConfig();
  const safetyConfig = config.safety;

  // Create session
  const sessionId = randomUUID();
  const session: Session = {
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

      // 2. Scale screenshot for the AI model (Anthropic recommends ≤ WXGA)
      const scaledScreenshot = await scaleScreenshot(screenshot, screenshotMaxWidth);

      // 3. Send to AI model (uses scaled screenshot)
      const response = await provider.analyze({
        task,
        screenshot: scaledScreenshot,
        history,
        systemPrompt,
      });

      // 4. Remap coordinates from scaled → original screen resolution
      if (response.action && screenshot.size.width !== scaledScreenshot.size.width) {
        remapCoordinates(response.action, scaledScreenshot.size, screenshot.size);
      }

      // Track tokens
      if (response.usage) {
        session.total_tokens_in += response.usage.input;
        session.total_tokens_out += response.usage.output;
      }

      // 5. Check if done
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
        // Run optional ecosystem integrations
        const logs = getActionLogs(sessionId);
        await runPostSessionIntegrations(session, logs).catch(() => {});
        onDone?.(session);
        await driver.dispose();
        return session;
      }

      // 4. Safety check before executing
      const safetyResult = checkAction(response.action, safetyConfig);
      if (!safetyResult.allowed) {
        // Action blocked by safety layer — tell the model
        history.push({
          action: null,
          reasoning: `BLOCKED by safety: ${safetyResult.reason}`,
          done: false,
        });
        await logAction({
          session_id: sessionId,
          step,
          action: response.action,
          reasoning: `BLOCKED: ${safetyResult.reason}`,
          screenshot_path: screenshotPath,
          success: false,
          error: safetyResult.reason,
          duration_ms: 0,
          tokens_in: response.usage?.input,
          tokens_out: response.usage?.output,
        });
        onStep?.(step, response, { success: false, error: safetyResult.reason, duration_ms: 0 });
        session.steps = step + 1;
        continue;
      }

      // 5. Execute the action (or simulate in dry-run mode)
      const result = dryRun
        ? { success: true, duration_ms: 0 } as ActionResult
        : await driver.execute(response.action);

      // 6. Log to DB
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

      // 9. Screenshot diff — detect if screen didn't change after action
      if (!dryRun && result.screenshot && response.action?.type !== "screenshot") {
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
    session.status = "completed";
    session.total_duration_ms = Date.now() - startTime;
    session.completed_at = new Date().toISOString();
    session.error = `Reached max steps (${maxSteps})`;
    await updateSession(session);
    const endLogs = getActionLogs(sessionId);
    await runPostSessionIntegrations(session, endLogs).catch(() => {});
    onDone?.(session);
    await driver.dispose();
    return session;
  } catch (err) {
    session.status = "failed";
    session.error = err instanceof Error ? err.message : String(err);
    session.total_duration_ms = Date.now() - startTime;
    session.completed_at = new Date().toISOString();
    await updateSession(session);
    const errLogs = getActionLogs(sessionId);
    await runPostSessionIntegrations(session, errLogs).catch(() => {});
    onDone?.(session);
    await driver.dispose();
    return session;
  }
}

/**
 * Remap coordinates from scaled screenshot space to original screen space.
 * When we scale a 2560x1600 screen to 1280x800 for the model, the model
 * returns coordinates in 1280x800 space. We need to convert them back to
 * 2560x1600 before executing the action on the real screen.
 */
function remapCoordinates(
  action: import("../types/index.js").DriverAction,
  from: import("../types/index.js").ScreenSize,
  to: import("../types/index.js").ScreenSize
): void {
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;

  const remap = (p: import("../types/index.js").Point) => {
    p.x = Math.round(p.x * scaleX);
    p.y = Math.round(p.y * scaleY);
  };

  switch (action.type) {
    case "click":
    case "mouse_move":
      remap(action.point);
      break;
    case "scroll":
      remap(action.point);
      break;
    case "drag":
      remap(action.from);
      remap(action.to);
      break;
  }
}
