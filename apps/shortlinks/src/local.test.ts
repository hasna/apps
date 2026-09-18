import { describe, expect, test } from "bun:test";
import { createLocalSetupPlan } from "./local.js";

describe("local setup helpers", () => {
  test("renders machine-readable hosts and proxy setup", () => {
    const plan = createLocalSetupPlan({ domain: "https://HAS.NA/path", port: 8787 });

    expect(plan.domain).toBe("has.na");
    expect(plan.hostsEntry).toBe("127.0.0.1 has.na");
    expect(plan.caddySnippet).toContain("reverse_proxy 127.0.0.1:8787");
    expect(plan.machinesCommand).toBe("machines dns add --domain has.na --target-host 127.0.0.1 --port 8787 --json");
    expect(plan.sudoRequired).toBe(true);
  });
});
