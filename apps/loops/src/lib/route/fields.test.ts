import { describe, expect, test } from "bun:test";
import { taskEventField, taskRouteEligibility } from "./fields.js";

describe("taskRouteEligibility route opt-in", () => {
  test("honors the todos `route:enabled` tag as equivalent to `auto:route`", () => {
    // Regression: todos hands out `route:enabled` as its opt-in tag, but loops
    // only honored `auto:route`, so route-tagged tasks were silently dropped.
    const enabled = taskRouteEligibility({ tags: ["route:enabled"] }, {});
    expect(enabled.eligible).toBe(true);

    const legacy = taskRouteEligibility({ tags: ["auto:route"] }, {});
    expect(legacy.eligible).toBe(true);
  });

  test("still requires an explicit opt-in when neither tag nor field is present", () => {
    const result = taskRouteEligibility({ tags: ["some-other-tag"] }, {});
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("missing explicit route opt-in");
  });

  test("route:enabled does not override disallowed tags or non-routable status", () => {
    const blockedTag = taskRouteEligibility({ tags: ["route:enabled", "blocked"] }, {});
    expect(blockedTag.eligible).toBe(false);

    const doneStatus = taskRouteEligibility({ tags: ["route:enabled"], status: "done" }, {});
    expect(doneStatus.eligible).toBe(false);
  });

  test("auto:route remains sufficient even when route state says ineligible", () => {
    const routeStateIneligible = taskRouteEligibility({
      tags: ["auto:route"],
      route_state: { eligible: false, notes: ["route_not_enabled"] },
    }, {});
    expect(routeStateIneligible.eligible).toBe(true);
  });

  test("extracts task fields from OpenEvents payload.task envelopes", () => {
    const data = {
      payload: {
        task: {
          id: "task-open-events-payload",
          title: "Route nested task payload",
          project_path: "/tmp/open-loops",
        },
      },
    };

    expect(taskEventField(data, ["id", "taskId"])).toBe("task-open-events-payload");
    expect(taskEventField(data, ["title"])).toBe("Route nested task payload");
    expect(taskEventField(data, ["project_path", "projectPath"])).toBe("/tmp/open-loops");
  });

  test("honors nested OpenTodos metadata opt-in and manual gates", () => {
    const eligible = taskRouteEligibility({
      payload: {
        task: {
          metadata: {
            route_enabled: true,
            automation: { allowed: true, mode: "auto" },
          },
        },
      },
    }, {});
    expect(eligible.eligible).toBe(true);

    const manual = taskRouteEligibility({
      payload: {
        task: {
          tags: ["auto:route"],
          metadata: {
            automation: { allowed: true, manual_required: true },
          },
        },
      },
    }, {});
    expect(manual.eligible).toBe(false);
    expect(manual.reason).toContain("manual_required");
  });

  test.each([
    ["approval required", { requires_approval: true }],
    ["approval required camelCase", { approvalRequired: true }],
    ["manual required", { manual_required: true }],
    ["no auto", { no_auto: true }],
  ])("rejects %s metadata even with route opt-in", (_, gate) => {
    const result = taskRouteEligibility({
      tags: ["route:enabled"],
      metadata: gate,
    }, {});
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("manual or approval-gated");
  });
});
