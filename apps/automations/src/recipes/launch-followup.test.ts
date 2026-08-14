import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationsStore, validateAutomationSpec } from "../index.js";
import {
  ENGAGEMENT_CHECK_OFFSET_DAYS,
  LAUNCH_FOLLOWUP_RECIPE_PACK,
  LAUNCH_FOLLOWUP_RECIPE_VERSION,
  engagementCheckRecipe,
  followupEnrollmentRecipe,
  launchFollowupRecipePack,
  listLaunchFollowupRecipes,
  loadRecipeSpecFile,
  uptimeWatchWindowRecipe,
  writeRecipePack,
} from "./launch-followup.js";

const baseOptions = {
  appId: "open-todos",
  package: "@hasna/todos",
  version: "1.2.3",
};

let dataDir = "";

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "hasna-automations-recipes-"));
  process.env.HASNA_AUTOMATIONS_DIR = dataDir;
});

afterEach(() => {
  delete process.env.HASNA_AUTOMATIONS_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("launch follow-up recipe pack", () => {
  test("renders five specs (T+1/T+3/T+7, enrollment, uptime watch) that all validate", () => {
    const specs = launchFollowupRecipePack(baseOptions);
    expect(specs).toHaveLength(5);
    for (const spec of specs) {
      expect(() => validateAutomationSpec(spec)).not.toThrow();
      expect(spec.metadata?.recipePack).toBe(LAUNCH_FOLLOWUP_RECIPE_PACK);
      expect(spec.metadata?.recipeVersion).toBe(LAUNCH_FOLLOWUP_RECIPE_VERSION);
      expect(spec.metadata?.appId).toBe("open-todos");
    }
    expect(specs.map((spec) => spec.id)).toEqual([
      "launch-followup.open-todos.t1-engagement",
      "launch-followup.open-todos.t3-engagement",
      "launch-followup.open-todos.t7-engagement",
      "launch-followup.open-todos.enroll-non-engaged",
      "launch-followup.open-todos.uptime-watch",
    ]);
  });

  test("engagement checks are schedule triggers anchored to release.published at T+1/3/7", () => {
    for (const offset of ENGAGEMENT_CHECK_OFFSET_DAYS) {
      const spec = engagementCheckRecipe({ ...baseOptions, releasedAt: "2026-07-06T09:00:00.000Z" }, offset);
      const trigger = spec.triggers[0]!;
      expect(trigger.kind).toBe("schedule");
      expect(trigger.type).toBe("schedule.release-offset");
      expect(trigger.metadata?.anchorEvent).toBe("release.published");
      expect(trigger.metadata?.offsetDays).toBe(offset);
      expect(trigger.metadata?.runAt).toBe(
        new Date(Date.parse("2026-07-06T09:00:00.000Z") + offset * 86_400_000).toISOString(),
      );
      const stepIds = spec.actions.map((action) => action.id);
      expect(stepIds).toEqual(["collect-engagement", "record-engagement-event"]);
      expect(spec.actions[1]!.dependsOn).toEqual(["collect-engagement"]);
    }
  });

  test("engagement threshold gating lives in the announce.report input contract, not in `when` steps", () => {
    const spec = engagementCheckRecipe({ ...baseOptions, engagementThreshold: 0.25 }, 3);
    // The control plane enqueues every step unconditionally and never
    // evaluates `when`, so no step may rely on it for conditional behavior.
    expect(spec.actions.every((action) => action.when === undefined)).toBe(true);
    const collect = spec.actions.find((action) => action.id === "collect-engagement")!;
    const input = collect.input as {
      onLowEngagement: { openRateBelow: number; createTodo: { title: string; project: string; tags: string[] } };
    };
    expect(input.onLowEngagement.openRateBelow).toBe(0.25);
    expect(input.onLowEngagement.createTodo.project).toBe("open-todos");
    expect(input.onLowEngagement.createTodo.title).toContain("Low engagement");
    expect(input.onLowEngagement.createTodo.tags).toEqual(["launch-followup", "engagement"]);
  });

  test("rejects unsupported engagement offsets and invalid app ids", () => {
    expect(() => engagementCheckRecipe(baseOptions, 2 as never)).toThrow(/offset/);
    expect(() => launchFollowupRecipePack({ ...baseOptions, appId: "Open Todos" })).toThrow(/slug appId/);
    expect(() => launchFollowupRecipePack({ ...baseOptions, releasedAt: "not-a-date" })).toThrow(/releasedAt/);
  });

  test("enrollment recipe targets non-engaged recipients with a policy-gated mailery step", () => {
    const spec = followupEnrollmentRecipe(baseOptions);
    expect(spec.triggers[0]!.metadata?.anchorEvent).toBe("announcement.sent");
    expect(spec.triggers[0]!.metadata?.offsetDays).toBe(3);
    const enroll = spec.actions.find((action) => action.actionId === "mailery.sequence.enroll")!;
    expect(enroll.dependsOn).toEqual(["list-non-engaged"]);
    expect(enroll.approval).toEqual({
      mode: "policy",
      requiresApproval: true,
      policy: "email-enrollment",
      reason: expect.stringContaining("email-enrollment") as never,
    });
    const input = enroll.input as { sequenceId: string; segment: string; respectSuppressionList: boolean; consentPolicy: string };
    expect(input.sequenceId).toBe("open-todos-launch-followup");
    expect(input.segment).toBe("non-engaged");
    expect(input.respectSuppressionList).toBe(true);
    expect(input.consentPolicy).toBe("opt_in");
  });

  test("uptime watch-window is event-triggered on release.published with app filter", () => {
    const spec = uptimeWatchWindowRecipe({ ...baseOptions, watchWindowHours: 48, uptimeMonitorId: "todos-prod" });
    const trigger = spec.triggers[0]!;
    expect(trigger.kind).toBe("event");
    expect(trigger.type).toBe("release.published");
    expect(trigger.filter).toEqual({ appId: "open-todos", package: "@hasna/todos" });
    const open = spec.actions.find((action) => action.id === "open-watch-window")!;
    const input = open.input as {
      monitorId: string;
      windowHours: number;
      baselineDays: number;
      onRegression: {
        emitEvent: { source: string; type: string; data: { monitorId: string } };
        createTodo: { title: string; project: string; tags: string[] };
      };
    };
    expect(input.monitorId).toBe("todos-prod");
    expect(input.windowHours).toBe(48);
    expect(input.baselineDays).toBe(7);
    // Regression follow-ups are gated INSIDE the action (onRegression input
    // contract). They must not be separate unconditional dependent steps:
    // the control plane never evaluates `when`, so dependent events.emit /
    // todos.create steps would fire on every registered release.
    expect(spec.actions.map((action) => action.id)).toEqual(["open-watch-window"]);
    expect(spec.actions.every((action) => action.when === undefined)).toBe(true);
    expect(input.onRegression.emitEvent.type).toBe("uptime.regression.detected");
    expect(input.onRegression.emitEvent.data.monitorId).toBe("todos-prod");
    expect(input.onRegression.createTodo.tags).toEqual(["launch-followup", "uptime", "regression"]);
  });

  test("defaults derive campaign, audience, sequence, and monitor ids from the app", () => {
    const spec = followupEnrollmentRecipe(baseOptions);
    const enroll = spec.actions.find((action) => action.actionId === "mailery.sequence.enroll")!;
    const input = enroll.input as { campaignId: string; audienceId: string };
    expect(input.campaignId).toBe("camp-open-todos-1.2.3");
    expect(input.audienceId).toBe("open-todos-users");
  });
});

describe("recipe pack loader", () => {
  test("writeRecipePack + loadRecipeSpecFile round-trips validated spec files", async () => {
    const outDir = join(dataDir, "rendered");
    const specs = launchFollowupRecipePack(baseOptions);
    const files = await writeRecipePack(outDir, specs);
    expect(files).toHaveLength(5);
    expect(await readdir(outDir)).toHaveLength(5);
    for (const [index, file] of files.entries()) {
      const loaded = loadRecipeSpecFile(file);
      expect(loaded).toEqual(specs[index]!);
    }
  });

  test("loadRecipeSpecFile rejects invalid spec files", async () => {
    const outDir = join(dataDir, "rendered-bad");
    const [file] = await writeRecipePack(outDir, launchFollowupRecipePack(baseOptions));
    const broken = JSON.parse(await Bun.file(file!).text()) as { actions: unknown[] };
    broken.actions = [];
    const brokenPath = join(outDir, "broken.json");
    await Bun.write(brokenPath, JSON.stringify(broken));
    expect(() => loadRecipeSpecFile(brokenPath)).toThrow(/at least one action/);
  });

  test("rendered specs register in the automations store", () => {
    const store = new AutomationsStore();
    try {
      for (const spec of launchFollowupRecipePack(baseOptions)) {
        const record = store.createAutomation(spec);
        expect(record.id).toBe(spec.id);
        expect(record.status).toBe("active");
      }
      expect(store.listAutomations()).toHaveLength(5);
    } finally {
      store.close();
    }
  });

  test("listLaunchFollowupRecipes describes the full pack", () => {
    const recipes = listLaunchFollowupRecipes();
    expect(recipes.map((recipe) => recipe.name)).toEqual([
      "t1-engagement",
      "t3-engagement",
      "t7-engagement",
      "enroll-non-engaged",
      "uptime-watch",
    ]);
    expect(recipes.every((recipe) => recipe.pack === LAUNCH_FOLLOWUP_RECIPE_PACK)).toBe(true);
  });
});
