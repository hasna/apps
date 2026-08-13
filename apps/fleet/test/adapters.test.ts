import { describe, expect, it } from "bun:test";
import { defaultAdapters, HASNA_INC, liveUpstreamEnabled } from "../src/adapters/index.js";

const adapters = defaultAdapters();

describe("fixture read-adapters", () => {
  it("monitor scales counts by window", () => {
    const full = adapters.monitor.getSamples({ entity_id: HASNA_INC, target_type: "agent", window_days: 30 });
    const half = adapters.monitor.getSamples({ entity_id: HASNA_INC, target_type: "agent", window_days: 15 });
    const r30 = full.find((s) => s.target_ref === "researcher")!;
    const r15 = half.find((s) => s.target_ref === "researcher")!;
    expect(r15.requests).toBe(Math.round(r30.requests / 2));
  });

  it("logs, economy and evals return per-agent samples", () => {
    const q = { entity_id: HASNA_INC, target_type: "agent" as const, window_days: 30 };
    expect(adapters.logs.getSamples(q).length).toBe(3);
    expect(adapters.economy.getSamples(q).every((s) => s.by_model.length >= 1)).toBe(true);
    expect(adapters.evals.getSamples(q).find((s) => s.target_ref === "triage")!.score).toBe(0.95);
  });

  it("sessions lists and fetches traces", () => {
    const traces = adapters.sessions.listTraces({ entity_id: HASNA_INC, target_type: "agent", window_days: 30, target_ref: "researcher" });
    expect(traces.length).toBe(4);
    expect(adapters.sessions.getTrace(HASNA_INC, traces[0]!.trace_id)).not.toBeNull();
    expect(adapters.sessions.getTrace(HASNA_INC, "missing")).toBeNull();
  });

  it("defaults to fixture adapters (live upstream disabled)", () => {
    expect(liveUpstreamEnabled()).toBe(false);
    expect(adapters.monitor.source).toBe("monitor");
  });
});
