import { describe, expect, test } from "bun:test";
import { taskRouteEligibility } from "./fields.js";

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
});
