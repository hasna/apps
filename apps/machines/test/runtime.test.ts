import { describe, expect, test } from "bun:test";
import type { EventInput } from "@hasna/events";
import { buildTmuxPaneDiedHookPlan, watchTmuxPane, type TmuxPaneProbeResult } from "../src/commands/runtime.js";

function probe(target: string, exists: boolean, paneId?: string): TmuxPaneProbeResult {
  return {
    target,
    exists,
    paneId,
    checkedAt: new Date().toISOString(),
    exitCode: exists ? 0 : 1,
    stderr: exists ? undefined : "can't find pane",
  };
}

describe("runtime tmux monitor", () => {
  test("builds an explicit trusted-local tmux pane-died hook plan", () => {
    const plan = buildTmuxPaneDiedHookPlan({ tmuxCommand: "tmux", machinesCommand: "machines", trustedLocalMutation: true });
    expect(plan.eventType).toBe("machines.tmux.pane_died");
    expect(plan.deliver).toBe(false);
    expect(plan.trustedLocalMutation).toBe(true);
    expect(plan.args).toEqual([
      "set-hook",
      "-g",
      "pane-died",
      expect.stringContaining("machines"),
    ]);
    expect(plan.shellCommand).toContain("pane-died");
    expect(plan.shellCommand).toContain("machines");
    expect(plan.shellCommand).toContain("events");
    expect(plan.shellCommand).toContain("emit");
    expect(plan.shellCommand).not.toContain("hasna-events");
    expect(plan.shellCommand).toContain("HASNA_MACHINES_ALLOW_MUTATIONS=1");
    expect(plan.shellCommand).toContain("--no-deliver");
  });

  test("rejects dependency-owned event binaries for tmux hook plans", () => {
    for (const machinesCommand of ["events", "hasna-events", "/tmp/node_modules/.bin/events", "/tmp/node_modules/.bin/hasna-events"]) {
      expect(() => buildTmuxPaneDiedHookPlan({ machinesCommand, trustedLocalMutation: true })).toThrow("must invoke the machines CLI");
    }
  });

  test("does not include trusted mutation env by default", () => {
    const plan = buildTmuxPaneDiedHookPlan({ tmuxCommand: "tmux", machinesCommand: "machines" });
    expect(plan.trustedLocalMutation).toBe(false);
    expect(plan.shellCommand).not.toContain("HASNA_MACHINES_ALLOW_MUTATIONS=1");
  });

  test("builds a tmux hook plan with a scoped approval token when provided", () => {
    const plan = buildTmuxPaneDiedHookPlan({
      tmuxCommand: "tmux",
      machinesCommand: "machines",
      approvalToken: "token-123",
    });
    expect(plan.trustedLocalMutation).toBe(false);
    expect(plan.shellCommand).toContain("--approval-token");
    expect(plan.shellCommand).toContain("token-123");
    expect(plan.shellCommand).not.toContain("HASNA_MACHINES_ALLOW_MUTATIONS=1");
  });

  test("emits pane_died after a previously present pane disappears", async () => {
    const emitted: Array<{ input: EventInput; options: unknown }> = [];
    const sequence = [
      probe("%11", true, "%11"),
      probe("%11", false),
    ];

    const result = await watchTmuxPane({
      target: "%11",
      intervalMs: 0,
      maxChecks: 2,
      sleep: async () => {},
      probe: async () => sequence.shift()!,
      client: {
        emit: async (input, options) => {
          emitted.push({ input, options });
          return {
            event: {
              id: "evt_runtime",
              source: input.source,
              type: input.type,
              time: new Date().toISOString(),
              subject: input.subject,
              severity: input.severity ?? "info",
              data: input.data ?? {},
              message: input.message,
              schemaVersion: input.schemaVersion ?? "1.0",
              metadata: input.metadata ?? {},
            },
            deliveries: [],
            deduped: false,
          };
        },
      },
    });

    expect(result.status).toBe("died");
    expect(result.emitted?.event.type).toBe("machines.tmux.pane_died");
    expect(emitted[0]?.input).toMatchObject({
      source: "machines",
      type: "machines.tmux.pane_died",
      subject: "tmux:%11",
      data: { target: "%11", paneId: "%11" },
      metadata: { monitor: "tmux-pane", runtime: "machines" },
    });
  });

  test("can emit an initial missing event for one-shot checks", async () => {
    const emitted: EventInput[] = [];
    const result = await watchTmuxPane({
      target: "session:0.1",
      maxChecks: 1,
      emitInitialMissing: true,
      deliver: false,
      probe: async () => probe("session:0.1", false),
      client: {
        emit: async (input) => {
          emitted.push(input);
          return {
            event: {
              id: "evt_missing",
              source: input.source,
              type: input.type,
              time: new Date().toISOString(),
              subject: input.subject,
              severity: input.severity ?? "info",
              data: input.data ?? {},
              message: input.message,
              schemaVersion: input.schemaVersion ?? "1.0",
              metadata: input.metadata ?? {},
            },
            deliveries: [],
            deduped: false,
          };
        },
      },
    });

    expect(result.status).toBe("missing");
    expect(emitted[0]?.type).toBe("machines.tmux.pane_missing");
  });
});
