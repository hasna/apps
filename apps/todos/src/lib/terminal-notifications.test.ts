import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfig } from "./config.js";
import {
  evaluateTerminalWatchRules,
  listTerminalNotificationRules,
  removeTerminalNotificationRule,
  renderTerminalNotification,
  testTerminalNotificationRule,
  upsertTerminalNotificationRule,
} from "./terminal-notifications.js";

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-terminal-notifications-"));
  process.env["HOME"] = home;
  resetConfig();
});

afterEach(() => {
  resetConfig();
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("terminal notification watch rules", () => {
  test("stores local rules and evaluates event filters without hosted services", () => {
    const rule = upsertTerminalNotificationRule({
      name: "blocked",
      events: ["task.blocked", "task.failed"],
      min_severity: "warning",
      bell: true,
      agent_ids: ["codex"],
      priorities: ["high"],
      contains: ["deploy"],
    });

    expect(rule.enabled).toBe(true);
    expect(listTerminalNotificationRules()).toHaveLength(1);

    const result = testTerminalNotificationRule("blocked", {
      type: "task.failed",
      timestamp: "2026-01-02T03:04:05.000Z",
      payload: {
        id: "task-123456",
        title: "Deploy check failed",
        agent_id: "codex",
        priority: "high",
        api_key: "abcdefghijklmnopqrstuvwxyz",
      },
    });

    expect(result.matched).toBe(true);
    expect(result.notifications[0]).toMatchObject({
      rule: "blocked",
      event_type: "task.failed",
      severity: "critical",
      bell: true,
      task_id: "task-123456",
      agent_id: "codex",
    });
    expect(result.notifications[0]!.payload.api_key).toBe("[REDACTED]");
    expect(renderTerminalNotification(result.notifications[0]!)).toContain("CRITICAL task.failed task-123");
  });

  test("reports skipped reasons and supports bulk local rule evaluation", () => {
    upsertTerminalNotificationRule({
      name: "assigned",
      events: ["task.assigned"],
      min_severity: "info",
      project_ids: ["project-a"],
    });
    upsertTerminalNotificationRule({
      name: "disabled",
      events: ["*"],
      enabled: false,
    });

    const results = evaluateTerminalWatchRules({
      type: "task.assigned",
      payload: { title: "Assign review", project_id: "project-b" },
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.matched).toBe(false);
    expect(results[0]!.skipped_reasons).toContain("project does not match rule");
    expect(results[1]!.skipped_reasons).toContain("rule disabled");
    expect(removeTerminalNotificationRule("assigned")).toBe(true);
  });
});
