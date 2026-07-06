import React from "react";
import { Box, Text, render } from "ink";
import { agentHealth } from "../services/rollup-service.js";
import type { OpContext } from "../services/registry.js";
import type { HealthRollup } from "../types/index.js";

// Minimal Ink TUI: a one-shot health table for an entity. This keeps the CLI/TUI
// stack (Ink + commander) real while remaining non-interactive-friendly.

function statusColor(status: HealthRollup["status"]): string {
  return status === "healthy" ? "green" : status === "degraded" ? "yellow" : "red";
}

function Dashboard({ rows, entityId }: { rows: HealthRollup[]; entityId: string }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>fleet — agent health for {entityId}</Text>
      {rows.length === 0 ? (
        <Text dimColor>(no agents under this entity)</Text>
      ) : (
        rows.map((r) => (
          <Text key={r.target_ref}>
            <Text color={statusColor(r.status)}>{r.status.padEnd(10)}</Text>
            {" "}
            {r.target_ref.padEnd(14)} err={r.error_rate}% p95={r.latency_p95_ms}ms eval={r.eval_score ?? "n/a"}
          </Text>
        ))
      )}
    </Box>
  );
}

export async function renderDashboard(ctx: OpContext, entityId: string, windowDays: number): Promise<void> {
  const rows = agentHealth(ctx.adapters, entityId, windowDays);
  const instance = render(<Dashboard rows={rows} entityId={entityId} />);
  instance.unmount();
  await instance.waitUntilExit();
}
