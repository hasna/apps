import { describe, expect, test } from "bun:test";
import {
  browserToolInputSchema,
  computerToolInputSchema,
  createPlannerTools,
  fleetArtifactMaxBytesSchema,
  fleetMachineIdSchema,
  fleetToolInputSchema,
  resourceIdSchema,
  terminalToolInputSchema,
} from "../src/agent/planner-tools.js";
import { FLEET_ARTIFACT_HARD_MAX_BYTES } from "../src/agent/fleet-artifacts.js";

describe("AI SDK planner tool schemas", () => {
  test("exposes the expected planner tool set", () => {
    expect(Object.keys(createPlannerTools()).sort()).toEqual([
      "app",
      "approval",
      "browser",
      "computer",
      "fleet",
      "memory",
      "observation",
      "storage",
      "terminal",
    ]);
  });

  test("rejects invalid computer coordinates", () => {
    expect(computerToolInputSchema.safeParse({
      action: "click",
      point: { x: -1, y: 10 },
    }).success).toBe(false);

    expect(computerToolInputSchema.safeParse({
      action: "click",
      point: { x: 10, y: 10 },
    }).success).toBe(true);
  });

  test("rejects unsafe URLs for computer and browser tools", () => {
    expect(computerToolInputSchema.safeParse({
      action: "open_url",
      url: "javascript:alert(1)",
    }).success).toBe(false);

    expect(browserToolInputSchema.safeParse({
      action: "navigate",
      url: "https://example.com",
    }).success).toBe(true);
  });

  test("rejects terminal commands blocked by command policy", () => {
    expect(terminalToolInputSchema.safeParse({
      dir: process.cwd(),
      commands: ["sudo rm -rf /"],
    }).success).toBe(false);

    expect(terminalToolInputSchema.safeParse({
      dir: process.cwd(),
      commands: ["bun test"],
    }).success).toBe(true);
  });

  test("rejects invalid resource IDs in fleet and resource schemas", () => {
    expect(resourceIdSchema.safeParse("../private").success).toBe(false);
    expect(resourceIdSchema.safeParse("machine 1").success).toBe(false);
    expect(resourceIdSchema.safeParse("machine-06484d2de7").success).toBe(true);
    expect(fleetMachineIdSchema.safeParse("alice@host:/tmp").success).toBe(false);
    expect(fleetMachineIdSchema.safeParse("machine/06484d2de7").success).toBe(false);

    expect(fleetToolInputSchema.safeParse({
      machineId: "../private",
      action: "capabilities",
    }).success).toBe(false);
  });

  test("requires mutation-specific fleet fields", () => {
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "run_smoke",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "run_smoke",
      workspacePath: process.cwd(),
    }).success).toBe(true);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "ssh/id_rsa",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "smoke/report.json",
    }).success).toBe(true);
  });

  test("rejects unsafe fleet artifact pull contract fields", () => {
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports/.env",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports/",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports//x",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports/http://x",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports/a:b",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports/a@b",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "screenshots/.ssh/id_rsa",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports/private-token.txt",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports/result.json",
      sourceScope: "filesystem",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports/result.json",
      maxBytes: FLEET_ARTIFACT_HARD_MAX_BYTES + 1,
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports/result.json",
      mode: "materialize",
    }).success).toBe(false);
    expect(fleetToolInputSchema.safeParse({
      machineId: "machine-06484d2de7",
      action: "pull_artifact",
      artifactId: "reports/result.json",
      mode: "materialize",
      expectedSha256: "a".repeat(64),
    }).success).toBe(true);

    expect(fleetArtifactMaxBytesSchema.safeParse(FLEET_ARTIFACT_HARD_MAX_BYTES).success).toBe(true);
  });
});
