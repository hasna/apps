/**
 * Tests for vision-based element finding (src/lib/vision-fallback.ts):
 * the deterministic no-key path, model selection via env override, and the
 * response parser (including markdown-fenced JSON) against a mocked fetch.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { findElementByVision } from "./vision-fallback.js";
import type { Page } from "playwright";

let savedKey: string | undefined;
let savedModel: string | undefined;
let savedFetch: typeof globalThis.fetch;

beforeEach(() => {
  savedKey = process.env["ANTHROPIC_API_KEY"];
  savedModel = process.env["BROWSER_VISION_MODEL"];
  savedFetch = globalThis.fetch;
  delete process.env["ANTHROPIC_API_KEY"];
  delete process.env["BROWSER_VISION_MODEL"];
});

afterEach(() => {
  if (savedKey === undefined) delete process.env["ANTHROPIC_API_KEY"];
  else process.env["ANTHROPIC_API_KEY"] = savedKey;
  if (savedModel === undefined) delete process.env["BROWSER_VISION_MODEL"];
  else process.env["BROWSER_VISION_MODEL"] = savedModel;
  globalThis.fetch = savedFetch;
});

function makePage(): Page {
  return {
    screenshot: async () => Buffer.from("fake-jpeg-bytes"),
    viewportSize: () => ({ width: 1280, height: 720 }),
  } as unknown as Page;
}

describe("vision fallback — no API key", () => {
  it("returns a deterministic error without calling fetch", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; throw new Error("must not be called"); };
    const result = await findElementByVision(makePage(), "the submit button");
    expect(result.found).toBe(false);
    expect(result.confidence).toBe("none");
    expect(result.error).toBe("ANTHROPIC_API_KEY not set");
    expect(result.model).toBe("claude-sonnet-4-5-20250929");
    expect(fetchCalled).toBe(false);
  });
});

describe("vision fallback — model selection", () => {
  it("uses the DEFAULT_MODEL when no env override is set", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key-not-a-real-credential";
    globalThis.fetch = async () => ({ json: async () => ({ content: [{ type: "text", text: '{"found": false, "x": 0, "y": 0, "confidence": "none", "description": "not found"}' }] }) }) as Response;
    const result = await findElementByVision(makePage(), "anything");
    expect(result.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("honors BROWSER_VISION_MODEL", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key-not-a-real-credential";
    process.env["BROWSER_VISION_MODEL"] = "custom-vision-model";
    globalThis.fetch = async () => ({ json: async () => ({ content: [{ type: "text", text: '{"found": false, "x": 0, "y": 0, "confidence": "none", "description": "not found"}' }] }) }) as Response;
    const result = await findElementByVision(makePage(), "anything");
    expect(result.model).toBe("custom-vision-model");
  });
});

describe("vision fallback — response parsing", () => {
  it("parses a plain JSON response", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key-not-a-real-credential";
    globalThis.fetch = async () => ({ json: async () => ({ content: [{ type: "text", text: '{"found": true, "x": 100, "y": 250, "confidence": "high", "description": "submit button"}' }] }) }) as Response;
    const result = await findElementByVision(makePage(), "submit");
    expect(result.found).toBe(true);
    expect(result.x).toBe(100);
    expect(result.y).toBe(250);
    expect(result.confidence).toBe("high");
    expect(result.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("parses a markdown-fenced JSON response", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key-not-a-real-credential";
    const fenced = "```json\n{\"found\": true, \"x\": 10, \"y\": 20, \"confidence\": \"medium\", \"description\": \"the canvas\"}\n```";
    globalThis.fetch = async () => ({ json: async () => ({ content: [{ type: "text", text: fenced }] }) }) as Response;
    const result = await findElementByVision(makePage(), "canvas");
    expect(result.found).toBe(true);
    expect(result.x).toBe(10);
    expect(result.confidence).toBe("medium");
  });

  it("returns an error object when the API call throws", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key-not-a-real-credential";
    globalThis.fetch = async () => { throw new Error("network down"); };
    const result = await findElementByVision(makePage(), "anything");
    expect(result.found).toBe(false);
    expect(result.error).toBe("network down");
  });

  it("returns an error object on malformed JSON", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key-not-a-real-credential";
    globalThis.fetch = async () => ({ json: async () => ({ content: [{ type: "text", text: "not json at all" }] }) }) as Response;
    const result = await findElementByVision(makePage(), "anything");
    expect(result.found).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
