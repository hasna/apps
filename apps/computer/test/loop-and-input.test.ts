// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { describe, expect, test } from "bun:test";
import { remapCoordinates } from "../src/agent/loop.js";
import { executeAction, mapKeys } from "../src/drivers/mac/input.js";
import type { DriverAction, ScreenSize } from "../src/types/index.js";

describe("remapCoordinates — scaled → original screen space", () => {
  const FROM: ScreenSize = { width: 1280, height: 800 };
  const TO: ScreenSize = { width: 2560, height: 1600 };

  test("doubles click coordinates at 2x scale", () => {
    const action: DriverAction = { type: "click", point: { x: 500, y: 400 } };
    remapCoordinates(action, FROM, TO);
    expect(action).toEqual({ type: "click", point: { x: 1000, y: 800 } });
  });

  test("remaps both endpoints of a drag", () => {
    const action: DriverAction = { type: "drag", from: { x: 100, y: 100 }, to: { x: 200, y: 300 } };
    remapCoordinates(action, FROM, TO);
    expect(action).toEqual({ type: "drag", from: { x: 200, y: 200 }, to: { x: 400, y: 600 } });
  });

  test("remaps scroll and mouse_move points", () => {
    const scroll: DriverAction = { type: "scroll", point: { x: 10, y: 20 }, deltaX: 0, deltaY: 3 };
    remapCoordinates(scroll, FROM, TO);
    expect(scroll.point).toEqual({ x: 20, y: 40 });

    const move: DriverAction = { type: "mouse_move", point: { x: 640, y: 400 } };
    remapCoordinates(move, FROM, TO);
    expect(move.point).toEqual({ x: 1280, y: 800 });
  });

  test("rounds fractional coordinates (2/3 scale)", () => {
    const action: DriverAction = { type: "click", point: { x: 100, y: 100 } };
    remapCoordinates(action, { width: 1920, height: 1080 }, { width: 1280, height: 720 });
    // 100 * 1280/1920 = 66.67 → 67; 100 * 720/1080 = 66.67 → 67
    expect(action).toEqual({ type: "click", point: { x: 67, y: 67 } });
  });

  test("leaves non-coordinate actions untouched", () => {
    const type: DriverAction = { type: "type", text: "hi" };
    remapCoordinates(type, FROM, TO);
    expect(type).toEqual({ type: "type", text: "hi" });

    const wait: DriverAction = { type: "wait", ms: 5 };
    remapCoordinates(wait, FROM, TO);
    expect(wait).toEqual({ type: "wait", ms: 5 });
  });

  test("identity scale changes nothing", () => {
    const action: DriverAction = { type: "click", point: { x: 77, y: 88 } };
    remapCoordinates(action, FROM, FROM);
    expect(action.point).toEqual({ x: 77, y: 88 });
  });
});

describe("mapKeys — cliclick key name mapping", () => {
  test("enter/return map to return", () => {
    expect(mapKeys("enter")).toBe("return");
    expect(mapKeys("return")).toBe("return");
  });

  test("arrow keys map to arrow-*", () => {
    expect(mapKeys("up")).toBe("arrow-up");
    expect(mapKeys("down")).toBe("arrow-down");
    expect(mapKeys("left")).toBe("arrow-left");
    expect(mapKeys("right")).toBe("arrow-right");
  });

  test("esc/escape and backspace/delete map to the cliclick spellings", () => {
    expect(mapKeys("esc")).toBe("escape");
    expect(mapKeys("escape")).toBe("escape");
    expect(mapKeys("backspace")).toBe("delete");
    expect(mapKeys("delete")).toBe("delete");
  });

  test("modifier combos map per-part and are case-insensitive", () => {
    expect(mapKeys("CMD+ENTER")).toBe("cmd+return");
    expect(mapKeys("ctrl+shift+a")).toBe("ctrl+shift+a");
    expect(mapKeys("cmd+up")).toBe("cmd+arrow-up");
  });

  test("unknown keys pass through untouched", () => {
    expect(mapKeys("fn+f13")).toBe("fn+f13");
    expect(mapKeys("cmd+option+escape")).toBe("cmd+option+escape");
  });
});

describe("executeAction — fail-closed on unsupported platforms", () => {
  test("unknown action types fail with a named error instead of hanging", async () => {
    const result = await executeAction({ type: "teleport" } as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown action type");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("macOS-only actions fail closed when macOS tools are absent (non-darwin only)", async () => {
    // On macOS with screencapture this test would exercise real hardware; the
    // fail-closed contract below is about unsupported platforms, so only run
    // where the driver cannot work by construction.
    if (process.platform === "darwin") return;
    const result = await executeAction({ type: "wait", ms: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
