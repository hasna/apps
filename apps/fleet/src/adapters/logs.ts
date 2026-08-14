import type { AdapterQuery, LogsAdapter, LogsSample } from "./types.js";
import { agentsForEntity } from "./fixtures.js";

// Fixture read-adapter for @hasna/logs (log volume + error counts).
export class FixtureLogsAdapter implements LogsAdapter {
  readonly source = "logs" as const;

  getSamples(q: AdapterQuery): LogsSample[] {
    const scale = q.window_days / 30;
    return agentsForEntity(q.entity_id)
      .filter((a) => !q.target_ref || a.ref === q.target_ref)
      .map((a) => ({
        target_ref: a.ref,
        log_count: Math.round(a.log_count * scale),
        error_count: Math.round(a.error_logs * scale),
      }));
  }
}
