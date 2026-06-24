import { beforeEach, describe, expect, test } from "bun:test";
import {
  evaluateComputerAction,
  evaluateTerminalCommandPolicy,
  executeComputerAction,
  formatPolicyRejection,
  recordTerminalCommandPolicyAudit,
} from "../src/agent/policy.js";
import { resetRateLimiter } from "../src/agent/safety.js";
import { requestEmergencyStop, resetRunControlForTests } from "../src/agent/control.js";
import { listAuditEvents } from "../src/db/index.js";
import { MacDriver } from "../src/drivers/mac/index.js";
import type { ActionExecutor, DriverAction, SafetyConfig } from "../src/index.js";

const SAFETY: SafetyConfig = {
  blockedApps: ["Keychain Access"],
  blockedDomains: ["bank.example.com"],
  confirmClicks: false,
  maxActionsPerMinute: 60,
  allowPasswordTyping: false,
};

describe("action policy facade", () => {
  beforeEach(() => {
    resetRateLimiter();
    resetRunControlForTests();
  });

  test("blocks denied actions before the executor runs", async () => {
    let calls = 0;
    const executor: ActionExecutor = async () => {
      calls += 1;
      return { success: true, duration_ms: 1 };
    };

    const result = await executeComputerAction(
      { type: "open_app", name: "Keychain Access" },
      { safety: SAFETY, executor }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Blocked app");
    expect(calls).toBe(0);
  });

  test("treats confirmation-required clicks as a hard stop until approved", async () => {
    let calls = 0;
    const executor: ActionExecutor = async () => {
      calls += 1;
      return { success: true, duration_ms: 1 };
    };

    const result = await executeComputerAction(
      { type: "click", point: { x: 10, y: 20 } },
      { safety: { ...SAFETY, confirmClicks: true }, executor }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("requires confirmation");
    expect(calls).toBe(0);
  });

  test("executes confirmation-required actions only when approved", async () => {
    let calls = 0;
    const executor: ActionExecutor = async (action) => {
      calls += 1;
      expect(action.type).toBe("click");
      return { success: true, duration_ms: 1 };
    };

    const result = await executeComputerAction(
      { type: "click", point: { x: 10, y: 20 } },
      { safety: { ...SAFETY, confirmClicks: true }, approved: true, executor }
    );

    expect(result.success).toBe(true);
    expect(calls).toBe(1);
  });

  test("exposes confirmation decisions for transports that need custom responses", () => {
    const decision = evaluateComputerAction(
      { type: "key", keys: "cmd+shift+delete" },
      { safety: SAFETY }
    );

    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe("requires_confirmation");
    expect(formatPolicyRejection(decision)).toContain("requires confirmation");
  });

  test("writes redacted audit events for confirmation-required typed text", async () => {
    const marker = `policy_${Date.now()}_${Math.random()}`;
    const executor: ActionExecutor = async () => {
      throw new Error("executor should not run");
    };

    const result = await executeComputerAction(
      { type: "type", text: "P@ssw0rd123!" },
      {
        safety: { ...SAFETY, confirmClicks: true },
        executor,
        transport: "policy-test",
        metadata: { marker },
      }
    );

    const events = listAuditEvents({ transport: "policy-test", limit: 20 });
    const event = events.find((candidate) => candidate.metadata?.marker === marker);
    expect(result.success).toBe(false);
    expect(event).toBeDefined();
    expect(event!.decision).toBe("requires_confirmation");
    expect(event!.action_data).toEqual({
      type: "type",
      text: "[redacted]",
      text_length: 12,
      redacted: true,
    });
  });

  test("blocks direct high-risk action paths before executor dispatch and audits every attempt", async () => {
    const marker = `direct_bypass_${Date.now()}_${Math.random()}`;
    let calls = 0;
    const executor: ActionExecutor = async () => {
      calls += 1;
      return { success: true, duration_ms: 1 };
    };
    const cases: Array<{
      label: string;
      action: DriverAction;
      safety: SafetyConfig;
      decision: "blocked" | "requires_confirmation";
      error: string;
    }> = [
      {
        label: "click",
        action: { type: "click", point: { x: 1, y: 2 } },
        safety: { ...SAFETY, confirmClicks: true },
        decision: "requires_confirmation",
        error: "requires confirmation",
      },
      {
        label: "type",
        action: { type: "type", text: "P@ssw0rd123!" },
        safety: { ...SAFETY, confirmClicks: true },
        decision: "requires_confirmation",
        error: "requires confirmation",
      },
      {
        label: "key",
        action: { type: "key", keys: "cmd+shift+delete" },
        safety: SAFETY,
        decision: "requires_confirmation",
        error: "requires confirmation",
      },
      {
        label: "open_url",
        action: { type: "open_url", url: "https://bank.example.com/login" },
        safety: SAFETY,
        decision: "blocked",
        error: "Blocked domain",
      },
      {
        label: "open_app",
        action: { type: "open_app", name: "Keychain Access" },
        safety: SAFETY,
        decision: "blocked",
        error: "Blocked app",
      },
    ];

    for (const item of cases) {
      const result = await executeComputerAction(item.action, {
        safety: item.safety,
        executor,
        transport: "direct-bypass-test",
        metadata: { marker, label: item.label },
      });

      expect(result.success, item.label).toBe(false);
      expect(result.error, item.label).toContain(item.error);
    }

    expect(calls).toBe(0);
    const events = listAuditEvents({ transport: "direct-bypass-test", limit: 50 });
    for (const item of cases) {
      const event = events.find((candidate) => candidate.metadata?.marker === marker && candidate.metadata?.label === item.label);
      expect(event, item.label).toBeDefined();
      expect(event!.decision).toBe(item.decision);
      expect(event!.capability).toBe(`computer.${item.action.type}`);
    }
  });

  test("requires approval and workspace-bound dir for terminal app driver commands", async () => {
    const workspace = process.cwd();

    expect(evaluateTerminalCommandPolicy(
      { app: "ghostty", run: ["bun test"] },
      { approved: true, workspaceRoots: [workspace] },
    )).toEqual({
      allowed: false,
      status: "blocked",
      reason: "Terminal commands require an explicit --dir inside an approved workspace root.",
    });

    expect(evaluateTerminalCommandPolicy(
      { app: "ghostty", run: ["bun test"], dir: "/tmp" },
      { approved: true, workspaceRoots: [workspace] },
    ).status).toBe("blocked");

    expect(evaluateTerminalCommandPolicy(
      { app: "ghostty", run: ["bun test"], dir: workspace },
      { workspaceRoots: [workspace] },
    )).toEqual({
      allowed: false,
      status: "requires_confirmation",
      reason: "Terminal command execution requires explicit operator approval.",
    });

    expect(evaluateTerminalCommandPolicy(
      { app: "ghostty", run: ["bun test"], dir: workspace },
      { approved: true, workspaceRoots: [workspace] },
    )).toEqual({ allowed: true, status: "allowed" });
  });

  test("blocks terminal commands denied by command policy even when approved", () => {
    const workspace = process.cwd();

    const decision = evaluateTerminalCommandPolicy(
      { app: "ghostty", run: ["sudo rm -rf /"], dir: workspace },
      { approved: true, workspaceRoots: [workspace] },
    );

    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe("blocked");
    expect(decision.reason).toContain("command policy");
  });

  test("audits terminal command policy without storing command text", async () => {
    const marker = `terminal_policy_${Date.now()}_${Math.random()}`;
    const decision = evaluateTerminalCommandPolicy(
      { app: "ghostty", run: ["echo secret"], dir: process.cwd() },
      { workspaceRoots: [process.cwd()] },
    );
    await recordTerminalCommandPolicyAudit(
      { app: "ghostty", run: ["echo secret"], dir: process.cwd() },
      decision,
      { transport: "policy-test", metadata: { marker } },
    );

    const event = listAuditEvents({ transport: "policy-test", capability: "computer.terminal", limit: 20 })
      .find((candidate) => candidate.metadata?.marker === marker);
    expect(event).toBeDefined();
    expect(event!.decision).toBe("requires_confirmation");
    expect(event!.action_data).toEqual({
      app: "ghostty",
      command_count: 1,
      has_dir: true,
      redacted: true,
    });
    expect(JSON.stringify(event)).not.toContain("echo secret");
  });

  test("public MacDriver execute path is policy-backed", async () => {
    requestEmergencyStop("driver stop");
    const driver = new MacDriver();
    const result = await driver.execute({ type: "wait", ms: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toContain("driver stop");
    const event = listAuditEvents({ transport: "driver", capability: "computer.wait", limit: 5 })[0];
    expect(event?.decision).toBe("blocked");
  });
});
