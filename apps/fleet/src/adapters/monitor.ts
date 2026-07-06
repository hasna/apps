import type { AdapterQuery, MonitorAdapter, MonitorSample } from "./types.js";
import { agentsForEntity } from "./fixtures.js";

// Fixture read-adapter for @hasna/monitor (uptime/latency/error counts).
export class FixtureMonitorAdapter implements MonitorAdapter {
  readonly source = "monitor" as const;

  getSamples(q: AdapterQuery): MonitorSample[] {
    const scale = q.window_days / 30;
    return agentsForEntity(q.entity_id)
      .filter((a) => !q.target_ref || a.ref === q.target_ref)
      .map((a) => ({
        target_ref: a.ref,
        requests: Math.round(a.requests * scale),
        errors: Math.round(a.errors * scale),
        latency_p95_ms: a.latency_p95_ms,
        availability_pct: round2(100 - (a.errors / a.requests) * 100),
      }));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
