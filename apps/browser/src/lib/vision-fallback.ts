/**
 * Vision-based element finding — uses a screenshot + vision model to locate elements
 * when a11y tree and CSS selectors fail (canvas, complex SVGs, custom widgets).
 */

import type { Page } from "playwright";

export interface VisionFindResult {
  found: boolean;
  x: number;
  y: number;
  confidence: string;
  description: string;
  model: string;
  error?: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Take a screenshot and ask a vision model to find an element matching the description.
 * Returns coordinates to click.
 */
export async function findElementByVision(
  page: Page,
  description: string,
  opts?: { model?: string; maxWidth?: number }
): Promise<VisionFindResult> {
  const model = opts?.model ?? process.env["BROWSER_VISION_MODEL"] ?? DEFAULT_MODEL;

  // Take a screenshot for the vision model
  const screenshot = await page.screenshot({ type: "jpeg", quality: 80 });
  const base64 = screenshot.toString("base64");
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  // Try Anthropic first
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    return { found: false, x: 0, y: 0, confidence: "none", description, model, error: "ANTHROPIC_API_KEY not set" };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: base64 },
            },
            {
              type: "text",
              text: `Find the element matching this description: "${description}"

The screenshot is ${viewport.width}x${viewport.height} pixels.

Reply with ONLY a JSON object (no markdown, no explanation):
{"found": true, "x": <pixel_x>, "y": <pixel_y>, "confidence": "high|medium|low", "description": "<what you found>"}

If you cannot find the element:
{"found": false, "x": 0, "y": 0, "confidence": "none", "description": "not found"}`,
            },
          ],
        }],
      }),
    });

    const data = await response.json() as any;
    const text = data.content?.[0]?.text ?? "";

    // Parse JSON from response (handle markdown code blocks)
    const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(jsonStr) as VisionFindResult;
    result.model = model;
    return result;
  } catch (err) {
    return {
      found: false, x: 0, y: 0, confidence: "none", description, model,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Click at coordinates found by vision model.
 */
export async function clickByVision(
  page: Page,
  description: string,
  opts?: { model?: string }
): Promise<VisionFindResult> {
  const result = await findElementByVision(page, description, opts);
  if (result.found && result.x > 0 && result.y > 0) {
    await page.mouse.click(result.x, result.y);
  }
  return result;
}
