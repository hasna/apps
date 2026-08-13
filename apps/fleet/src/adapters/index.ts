import type { FleetAdapters } from "./types.js";
import { FixtureMonitorAdapter } from "./monitor.js";
import { FixtureLogsAdapter } from "./logs.js";
import { FixtureSessionsAdapter } from "./sessions.js";
import { FixtureEconomyAdapter } from "./economy.js";
import { FixtureEvalsAdapter } from "./evals.js";

export * from "./types.js";
export { FIXTURE_ENTITIES, HASNA_INC, ACME_RO } from "./fixtures.js";

/**
 * Assemble the default read-adapters. v0 returns the fixture implementations.
 * When HASNA_FLEET_LIVE_UPSTREAM=1 (v1, later) this is where live MCP/CLI-backed
 * adapters are swapped in — the rollup service depends only on the interfaces.
 */
export function defaultAdapters(): FleetAdapters {
  return {
    monitor: new FixtureMonitorAdapter(),
    logs: new FixtureLogsAdapter(),
    sessions: new FixtureSessionsAdapter(),
    economy: new FixtureEconomyAdapter(),
    evals: new FixtureEvalsAdapter(),
  };
}

export function liveUpstreamEnabled(): boolean {
  return process.env["HASNA_FLEET_LIVE_UPSTREAM"] === "1";
}
