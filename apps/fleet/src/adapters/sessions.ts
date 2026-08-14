import type { TraceDetail, TraceSummary } from "../types/index.js";
import type { AdapterQuery, SessionsAdapter } from "./types.js";
import { fixtureTraces, toTraceSummary } from "./fixtures.js";

// Fixture read-adapter for @hasna/sessions (trace/session drill-down).
export class FixtureSessionsAdapter implements SessionsAdapter {
  readonly source = "sessions" as const;

  listTraces(q: AdapterQuery): TraceSummary[] {
    return fixtureTraces(q.entity_id, q.target_ref).map(toTraceSummary);
  }

  getTrace(entityId: string, traceId: string): TraceDetail | null {
    return fixtureTraces(entityId).find((t) => t.trace_id === traceId) ?? null;
  }
}
