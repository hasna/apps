import { describe, expect, test } from "bun:test";
import { buildCertPlan, runCertPlan } from "../src/commands/cert.js";

describe("cert planning", () => {
  test("builds mkcert install and issue steps", () => {
    const plan = buildCertPlan(["app.local"]);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.steps.some((step) => step.command.includes("mkcert -install"))).toBe(true);
    expect(plan.steps.some((step) => step.command.includes("app.local"))).toBe(true);
  });

  test("requires confirmation to execute", () => {
    expect(() => runCertPlan(["app.local"], { apply: true, yes: false })).toThrow("Certificate generation requires --yes.");
  });
});
