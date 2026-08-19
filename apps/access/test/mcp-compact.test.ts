import { describe, expect, it } from "bun:test";
import { errorResult, formatError, toToolResult } from "../src/mcp/compact.js";
import { ValidationError } from "../src/types/index.js";

/**
 * Direct tests for the MCP result/error helpers (src/mcp/compact.ts).
 * formatError is exercised through the tool envelope in mcp-safety.test.ts;
 * these pin the helper contract itself, including the generic-error path.
 */

describe("toToolResult", () => {
  it("passes strings through as the text payload", () => {
    expect(toToolResult("plain")).toEqual({ content: [{ type: "text", text: "plain" }], structuredContent: "plain" });
  });

  it("serializes non-strings to JSON text while keeping the structured value", () => {
    const value = { ok: true, rows: [1, 2] };
    const result = toToolResult(value);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(value) }]);
    expect(result.structuredContent).toBe(value);
  });

  it("serializes JSON-compatible primitives exactly", () => {
    expect(toToolResult(null).content).toEqual([{ type: "text", text: "null" }]);
    expect(toToolResult(0).content).toEqual([{ type: "text", text: "0" }]);
    expect(toToolResult(false).content).toEqual([{ type: "text", text: "false" }]);
    expect(toToolResult([1, "two"]).content).toEqual([{ type: "text", text: '[1,"two"]' }]);
    expect(toToolResult(null).structuredContent).toBeNull();
    expect(toToolResult(false).structuredContent).toBe(false);
  });
});

describe("formatError", () => {
  it("normalizes an AccessError to its {code, message, suggestion} envelope", () => {
    const envelope = JSON.parse(formatError(new ValidationError("bad input"))) as {
      code: string;
      message: string;
      suggestion: string;
    };
    expect(envelope.code).toBe("VALIDATION_ERROR");
    expect(envelope.message).toBe("bad input");
    expect(envelope.suggestion).toBe(
      "Check the required fields and value formats, then retry.",
    );
  });

  it("normalizes a generic Error to INTERNAL_ERROR with an empty suggestion", () => {
    const envelope = JSON.parse(formatError(new Error("boom"))) as Record<string, string>;
    expect(envelope.code).toBe("INTERNAL_ERROR");
    expect(envelope.message).toBe("boom");
    expect(envelope.suggestion).toBe("");
  });

  it("normalizes a thrown string value without crashing", () => {
    const envelope = JSON.parse(formatError("raw failure")) as Record<string, string>;
    expect(envelope.code).toBe("INTERNAL_ERROR");
    expect(envelope.message).toBe("raw failure");
  });

  it("preserves only the public fields of a coded error — no stack, name, cause, or extras", () => {
    class CodedError extends Error {
      code = "CUSTOM_CODE";
      suggestion = "try something else";
      constructor(message: string) {
        super(message);
        this.stack = "should-not-leak";
      }
    }
    const envelope = JSON.parse(formatError(new CodedError("coded"))) as Record<string, string>;
    expect(envelope).toEqual({ code: "CUSTOM_CODE", message: "coded", suggestion: "try something else" });
  });
});

describe("errorResult", () => {
  it("wraps the formatted envelope in an MCP tool result with no structuredContent", () => {
    const result = errorResult(new ValidationError("nope"));
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(result.structuredContent).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, string>;
    expect(parsed.code).toBe("VALIDATION_ERROR");
    expect(parsed.message).toBe("nope");
    expect(Object.keys(parsed).sort()).toEqual(["code", "message", "suggestion"]);
  });
});
