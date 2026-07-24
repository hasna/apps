import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AutomationSpec, AutomationTrigger } from "../types.js";
import { AUTOMATION_SCHEMA_VERSION } from "../types.js";
import { validateAutomationSpec } from "../lib/store.js";

// ---------------------------------------------------------------------------
// Launch follow-up recipe pack (Hasna distribution apps plan).
//
// Shipped automation spec templates anchored on a release:
//   - T+1 / T+3 / T+7 engagement checks (announce report + low-engagement task)
//   - enrollment of non-engaged recipients into a mailery follow-up sequence
//   - a release-anchored uptime regression watch-window
//
// These are deterministic spec templates only — the daemon and runner stay
// untouched. Render them to files (`automations recipes render ...`),
// register them with `automations create`, and let the existing control
// plane materialize runs.
//
// Two platform constraints shape the specs:
//
// 1. The control plane enqueues every step of a matched automation and gates
//    dispatch ONLY on `dependsOn` success (`AutomationActionStep.when` is NOT
//    evaluated anywhere today — it is advisory metadata pending runner
//    support). Conditional behavior (engagement thresholds, regression
//    detection) therefore lives in the INPUT CONTRACT of the action that owns
//    the data (`onLowEngagement` / `onRegression` below), never in
//    unconditional dependent steps.
// 2. `schedule.release-offset` triggers are not matched by
//    `triggerMatchesEvent` and no scheduler exists yet: schedule-triggered
//    specs are registered but inert until the follow-up scheduler lane lands.
//    The event-triggered uptime watch (`release.published`) is live once its
//    action is implemented.
// ---------------------------------------------------------------------------

export const LAUNCH_FOLLOWUP_RECIPE_PACK = "launch-followup" as const;
export const LAUNCH_FOLLOWUP_RECIPE_VERSION = "1.0.0" as const;

/** Engagement checks run at T+1, T+3, and T+7 days after the release anchor. */
export const ENGAGEMENT_CHECK_OFFSET_DAYS = [1, 3, 7] as const;
export type EngagementCheckOffset = (typeof ENGAGEMENT_CHECK_OFFSET_DAYS)[number];

/** Event the schedule offsets are anchored to (distribution event catalog). */
export const RELEASE_ANCHOR_EVENT_TYPE = "release.published" as const;
export const ANNOUNCEMENT_ANCHOR_EVENT_TYPE = "announcement.sent" as const;

const APP_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface LaunchFollowupOptions {
  /** `hasna.app.v1` appId slug — the join key across distribution documents. */
  appId: string;
  /** npm package name of the release. */
  package: string;
  /** Released semver. */
  version: string;
  /** Announcement campaign id; defaults to `camp-<appId>-<version>`. */
  campaignId?: string;
  /** `hasna.audience.v1` audienceId; defaults to `<appId>-users`. */
  audienceId?: string;
  /** Mailery follow-up sequence id; defaults to `<appId>-launch-followup`. */
  mailerySequenceId?: string;
  /** Uptime monitor id; defaults to the appId. */
  uptimeMonitorId?: string;
  /** Optional explicit release anchor timestamp (ISO datetime). */
  releasedAt?: string;
  /** Regression watch-window length; defaults to 72 hours. */
  watchWindowHours?: number;
  /** Open-rate threshold below which a low-engagement task is filed; defaults to 0.1. */
  engagementThreshold?: number;
}

interface ResolvedOptions extends Required<Omit<LaunchFollowupOptions, "releasedAt">> {
  releasedAt?: string;
}

function resolveOptions(options: LaunchFollowupOptions): ResolvedOptions {
  if (!APP_ID_PATTERN.test(options.appId ?? "")) {
    throw new Error(`launch-followup recipes require a slug appId (got: ${options.appId})`);
  }
  if (!options.package) throw new Error("launch-followup recipes require a package name");
  if (!options.version) throw new Error("launch-followup recipes require a version");
  if (options.releasedAt !== undefined && Number.isNaN(new Date(options.releasedAt).getTime())) {
    throw new Error(`Invalid releasedAt datetime: ${options.releasedAt}`);
  }
  return {
    appId: options.appId,
    package: options.package,
    version: options.version,
    campaignId: options.campaignId ?? `camp-${options.appId}-${options.version}`,
    audienceId: options.audienceId ?? `${options.appId}-users`,
    mailerySequenceId: options.mailerySequenceId ?? `${options.appId}-launch-followup`,
    uptimeMonitorId: options.uptimeMonitorId ?? options.appId,
    releasedAt: options.releasedAt,
    watchWindowHours: options.watchWindowHours ?? 72,
    engagementThreshold: options.engagementThreshold ?? 0.1,
  };
}

function recipeMetadata(resolved: ResolvedOptions, recipe: string): Record<string, string> {
  return {
    recipePack: LAUNCH_FOLLOWUP_RECIPE_PACK,
    recipe,
    recipeVersion: LAUNCH_FOLLOWUP_RECIPE_VERSION,
    appId: resolved.appId,
    package: resolved.package,
    version: resolved.version,
  };
}

function releaseOffsetTrigger(
  resolved: ResolvedOptions,
  offsetDays: number,
  anchorEvent: string,
): AutomationTrigger {
  const metadata: Record<string, string | number> = {
    anchorEvent,
    offsetDays,
    appId: resolved.appId,
    package: resolved.package,
    version: resolved.version,
  };
  if (resolved.releasedAt) {
    metadata.anchorAt = new Date(resolved.releasedAt).toISOString();
    metadata.runAt = new Date(
      new Date(resolved.releasedAt).getTime() + offsetDays * 24 * 60 * 60 * 1000,
    ).toISOString();
  }
  return {
    kind: "schedule",
    source: "hasna.automations",
    type: "schedule.release-offset",
    metadata,
  };
}

/** T+N engagement check: pull the campaign report, file a task when engagement is low. */
export function engagementCheckRecipe(
  options: LaunchFollowupOptions,
  offsetDays: EngagementCheckOffset,
): AutomationSpec {
  if (!(ENGAGEMENT_CHECK_OFFSET_DAYS as readonly number[]).includes(offsetDays)) {
    throw new Error(`Unsupported engagement check offset: T+${offsetDays} (expected 1, 3, or 7)`);
  }
  const resolved = resolveOptions(options);
  const spec: AutomationSpec = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: `launch-followup.${resolved.appId}.t${offsetDays}-engagement`,
    name: `T+${offsetDays} engagement check for ${resolved.appId}@${resolved.version}`,
    version: LAUNCH_FOLLOWUP_RECIPE_VERSION,
    description: `Collect campaign engagement ${offsetDays} day(s) after ${RELEASE_ANCHOR_EVENT_TYPE}; the announce.report action files the low-engagement follow-up task itself when the open rate is below the onLowEngagement threshold (the control plane does not evaluate step conditions).`,
    status: "active",
    triggers: [releaseOffsetTrigger(resolved, offsetDays, RELEASE_ANCHOR_EVENT_TYPE)],
    actions: [
      {
        id: "collect-engagement",
        actionId: "announce.report",
        input: {
          campaignId: resolved.campaignId,
          offsetDays,
          // Threshold gating is part of the action's input contract: steps
          // are enqueued unconditionally by the control plane (`when` is not
          // evaluated), so the action that owns the engagement data applies
          // the condition and only then files the follow-up task.
          onLowEngagement: {
            openRateBelow: resolved.engagementThreshold,
            createTodo: {
              title: `Low engagement for ${resolved.appId}@${resolved.version} at T+${offsetDays}`,
              project: resolved.appId,
              tags: ["launch-followup", "engagement"],
            },
          },
        },
      },
      {
        id: "record-engagement-event",
        actionId: "events.emit",
        dependsOn: ["collect-engagement"],
        input: {
          source: "hasna.automations",
          type: "announce.engagement.checked",
          data: {
            appId: resolved.appId,
            package: resolved.package,
            version: resolved.version,
            campaignId: resolved.campaignId,
            offsetDays,
          },
        },
      },
    ],
    concurrency: { key: `launch-followup:${resolved.appId}:${resolved.version}`, limit: 1 },
    audit: { eventSource: "hasna.automations" },
    metadata: recipeMetadata(resolved, `t${offsetDays}-engagement`),
  };
  validateAutomationSpec(spec);
  return spec;
}

/** Enroll recipients who have not engaged with the announcement into a mailery follow-up sequence. */
export function followupEnrollmentRecipe(options: LaunchFollowupOptions): AutomationSpec {
  const resolved = resolveOptions(options);
  const spec: AutomationSpec = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: `launch-followup.${resolved.appId}.enroll-non-engaged`,
    name: `Enroll non-engaged recipients for ${resolved.appId}@${resolved.version}`,
    version: LAUNCH_FOLLOWUP_RECIPE_VERSION,
    description: `Three days after ${ANNOUNCEMENT_ANCHOR_EVENT_TYPE}, enroll recipients with no opens/clicks into the mailery follow-up sequence (consent and suppression respected by the action).`,
    status: "active",
    triggers: [releaseOffsetTrigger(resolved, 3, ANNOUNCEMENT_ANCHOR_EVENT_TYPE)],
    actions: [
      {
        id: "list-non-engaged",
        actionId: "announce.report",
        input: {
          campaignId: resolved.campaignId,
          segment: "non-engaged",
        },
      },
      {
        id: "enroll-followup-sequence",
        actionId: "mailery.sequence.enroll",
        dependsOn: ["list-non-engaged"],
        approval: {
          mode: "policy",
          requiresApproval: true,
          policy: "email-enrollment",
          reason: "Bulk enrollment into an email sequence requires the email-enrollment policy check.",
        },
        input: {
          sequenceId: resolved.mailerySequenceId,
          campaignId: resolved.campaignId,
          audienceId: resolved.audienceId,
          segment: "non-engaged",
          respectSuppressionList: true,
          consentPolicy: "opt_in",
        },
      },
      {
        id: "record-enrollment-event",
        actionId: "events.emit",
        dependsOn: ["enroll-followup-sequence"],
        input: {
          source: "hasna.automations",
          type: "mailery.sequence.enrolled",
          data: {
            appId: resolved.appId,
            campaignId: resolved.campaignId,
            sequenceId: resolved.mailerySequenceId,
            segment: "non-engaged",
          },
        },
      },
    ],
    concurrency: { key: `launch-followup:${resolved.appId}:${resolved.version}`, limit: 1 },
    audit: { eventSource: "hasna.automations" },
    metadata: recipeMetadata(resolved, "enroll-non-engaged"),
  };
  validateAutomationSpec(spec);
  return spec;
}

/** Release-anchored uptime regression watch-window. */
export function uptimeWatchWindowRecipe(options: LaunchFollowupOptions): AutomationSpec {
  const resolved = resolveOptions(options);
  const spec: AutomationSpec = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: `launch-followup.${resolved.appId}.uptime-watch`,
    name: `Uptime regression watch-window for ${resolved.appId}@${resolved.version}`,
    version: LAUNCH_FOLLOWUP_RECIPE_VERSION,
    description: `Open a ${resolved.watchWindowHours}h uptime regression watch-window when ${RELEASE_ANCHOR_EVENT_TYPE} fires for ${resolved.appId}, comparing against the 7-day pre-release baseline; the action emits uptime.regression.detected and files the regression task itself only when a regression is actually detected (onRegression input contract — the control plane does not evaluate step conditions).`,
    status: "active",
    triggers: [
      {
        kind: "event",
        source: "hasna.events",
        type: RELEASE_ANCHOR_EVENT_TYPE,
        filter: {
          appId: resolved.appId,
          package: resolved.package,
        },
      },
    ],
    actions: [
      {
        id: "open-watch-window",
        actionId: "uptime.watch-window.open",
        input: {
          monitorId: resolved.uptimeMonitorId,
          appId: resolved.appId,
          package: resolved.package,
          version: resolved.version,
          windowHours: resolved.watchWindowHours,
          baselineDays: 7,
          // Regression gating is part of the action's input contract: the
          // control plane enqueues every step of a matched automation
          // unconditionally (`when` is not evaluated), so emitting the
          // regression event and filing the regression task as separate
          // dependent steps would fire on EVERY registered release. The
          // uptime action owns the regression signal and performs both
          // follow-ups only when a regression is actually detected.
          onRegression: {
            emitEvent: {
              source: "hasna.automations",
              type: "uptime.regression.detected",
              data: {
                appId: resolved.appId,
                package: resolved.package,
                version: resolved.version,
                monitorId: resolved.uptimeMonitorId,
              },
            },
            createTodo: {
              title: `Uptime regression after ${resolved.appId}@${resolved.version}`,
              project: resolved.appId,
              tags: ["launch-followup", "uptime", "regression"],
            },
          },
        },
      },
    ],
    concurrency: { key: `launch-followup:${resolved.appId}:uptime`, limit: 1 },
    audit: { eventSource: "hasna.automations" },
    metadata: recipeMetadata(resolved, "uptime-watch"),
  };
  validateAutomationSpec(spec);
  return spec;
}

/** The full launch follow-up pack: T+1/T+3/T+7 checks, enrollment, uptime watch. */
export function launchFollowupRecipePack(options: LaunchFollowupOptions): AutomationSpec[] {
  return [
    ...ENGAGEMENT_CHECK_OFFSET_DAYS.map((offset) => engagementCheckRecipe(options, offset)),
    followupEnrollmentRecipe(options),
    uptimeWatchWindowRecipe(options),
  ];
}

export interface RecipeDescriptor {
  pack: string;
  name: string;
  description: string;
}

export function listLaunchFollowupRecipes(): RecipeDescriptor[] {
  return [
    ...ENGAGEMENT_CHECK_OFFSET_DAYS.map((offset) => ({
      pack: LAUNCH_FOLLOWUP_RECIPE_PACK,
      name: `t${offset}-engagement`,
      description: `T+${offset} engagement check (announce report with threshold-gated low-engagement task → engagement event)`,
    })),
    {
      pack: LAUNCH_FOLLOWUP_RECIPE_PACK,
      name: "enroll-non-engaged",
      description: "Enroll non-engaged recipients into a mailery follow-up sequence (policy-gated)",
    },
    {
      pack: LAUNCH_FOLLOWUP_RECIPE_PACK,
      name: "uptime-watch",
      description: "Release-anchored uptime regression watch-window (regression event + task gated inside the action)",
    },
  ];
}

// ---------------------------------------------------------------------------
// File rendering + loading
// ---------------------------------------------------------------------------

export function recipeSpecFileName(spec: AutomationSpec): string {
  return `${spec.id.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
}

/** Write a rendered pack to `<dir>/<spec-id>.json` files; returns the paths. */
export async function writeRecipePack(dir: string, specs: AutomationSpec[]): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (const spec of specs) {
    const filePath = join(dir, recipeSpecFileName(spec));
    await writeFile(filePath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
    paths.push(filePath);
  }
  return paths;
}

/** Load and validate a spec file rendered by the recipe pack (or any automation spec file). */
export function loadRecipeSpecFile(filePath: string): AutomationSpec {
  const spec = JSON.parse(readFileSync(filePath, "utf-8")) as AutomationSpec;
  validateAutomationSpec(spec);
  return spec;
}
