import { describe, test, expect } from "bun:test";
import type {
  Provider,
  DriverAction,
  Screenshot,
  Session,
  RunOptions,
  SafetyConfig,
  ComputerDriver,
  ComputerProvider,
} from "../src/types/index.js";

describe("types", () => {
  test("Provider type accepts valid values", () => {
    const a: Provider = "anthropic";
    const b: Provider = "openai";
    expect(a).toBe("anthropic");
    expect(b).toBe("openai");
  });

  test("DriverAction click shape", () => {
    const action: DriverAction = { type: "click", point: { x: 100, y: 200 }, button: "left" };
    expect(action.type).toBe("click");
  });

  test("DriverAction type shape", () => {
    const action: DriverAction = { type: "type", text: "hello" };
    expect(action.type).toBe("type");
  });

  test("DriverAction key shape", () => {
    const action: DriverAction = { type: "key", keys: "cmd+c" };
    expect(action.type).toBe("key");
  });

  test("DriverAction scroll shape", () => {
    const action: DriverAction = { type: "scroll", point: { x: 0, y: 0 }, deltaX: 0, deltaY: 3 };
    expect(action.type).toBe("scroll");
  });

  test("Screenshot shape", () => {
    const ss: Screenshot = { base64: "abc", size: { width: 1920, height: 1080 }, timestamp: Date.now() };
    expect(ss.size.width).toBe(1920);
  });

  test("Session shape", () => {
    const s: Session = {
      id: "test",
      task: "test task",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      status: "running",
      steps: 0,
      total_tokens_in: 0,
      total_tokens_out: 0,
      total_duration_ms: 0,
      created_at: new Date().toISOString(),
    };
    expect(s.status).toBe("running");
  });

  test("RunOptions minimal shape", () => {
    const opts: RunOptions = { task: "do something" };
    expect(opts.task).toBe("do something");
    expect(opts.provider).toBeUndefined();
    expect(opts.dryRun).toBeUndefined();
  });
});
