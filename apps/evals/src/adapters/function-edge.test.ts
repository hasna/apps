import { describe, expect, test, beforeAll } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { callFunctionAdapter } from "./function.js";

// Edge cases the base function-adapter suite does not reach: non-function
// exports, object/primitive return coercion, non-Error throws, and missing
// modules. Each asserts the exact error surface callers depend on.

let dir: string;

beforeAll(() => {
  dir = join(tmpdir(), "evals-fn-edge-" + Date.now());
  mkdirSync(dir, { recursive: true });
});

function writeModule(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

describe("Function adapter — edge cases", () => {
  test("reports a non-function export with the exact error shape", async () => {
    const modulePath = writeModule(
      "not-fn.js",
      `export const notAFunction = "I am a string";
       export const objectExport = { run: () => "nope" };`
    );

    const result = await callFunctionAdapter(
      { type: "function", modulePath, exportName: "notAFunction" },
      "hello"
    );
    expect(result.output).toBe("");
    expect(result.error).toContain('Export "notAFunction"');
    expect(result.error).toContain("is not a function");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("default export that is not a function reports the same error", async () => {
    const modulePath = writeModule("default-not-fn.js", `export default { hello: 1 };`);
    const result = await callFunctionAdapter({ type: "function", modulePath }, "x");
    expect(result.error).toContain('Export "default"');
    expect(result.error).toContain("is not a function");
  });

  test("serializes object results as JSON", async () => {
    const modulePath = writeModule(
      "object-result.js",
      `export default async (input) => ({ echo: input, count: 2 });`
    );
    const result = await callFunctionAdapter({ type: "function", modulePath }, "abc");
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.output)).toEqual({ echo: "abc", count: 2 });
  });

  test("serializes primitive non-string results", async () => {
    const modulePath = writeModule("number-result.js", `export default async () => 42;`);
    const result = await callFunctionAdapter({ type: "function", modulePath }, "x");
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("42");
  });

  test("returns null results as the string null", async () => {
    const modulePath = writeModule("null-result.js", `export default async () => null;`);
    const result = await callFunctionAdapter({ type: "function", modulePath }, "x");
    // JSON.stringify(null) === "null" — a defined string, not an error
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("null");
  });

  test("captures non-Error throws as their String() form", async () => {
    const modulePath = writeModule(
      "string-throw.js",
      `export default async () => { throw "plain string failure"; };`
    );
    const result = await callFunctionAdapter({ type: "function", modulePath }, "x");
    expect(result.output).toBe("");
    expect(result.error).toBe("plain string failure");
  });

  test("returns an error when the module file does not exist", async () => {
    const missing = join(dir, "does-not-exist-" + Date.now() + ".js");
    const result = await callFunctionAdapter(
      { type: "function", modulePath: missing },
      "x"
    );
    expect(result.output).toBe("");
    expect(result.error).toBeTruthy();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("supports synchronous (non-async) exports", async () => {
    const modulePath = writeModule("sync-fn.js", `export default (input) => "sync:" + input;`);
    const result = await callFunctionAdapter({ type: "function", modulePath }, "ok");
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("sync:ok");
  });
});
