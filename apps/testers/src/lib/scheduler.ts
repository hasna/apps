import type { Schedule } from "../types/index.js";
import { getEnabledSchedules, updateLastRun } from "../db/schedules.js";
import { getSchedule } from "../db/schedules.js";
import { runByFilter } from "./runner.js";
import { ScheduleNotFoundError } from "../types/index.js";

// ─── Cron Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a single cron field into an array of matching integer values.
 *
 * Supports:
 *   "*"       → all values in [min, max]
 *   "N"       → exact value
 *   "N-M"     → inclusive range
 *   "N,M,O"   → list (each element may itself be a range or step)
 *   "* /N"     → every Nth value starting from min  (written without the space)
 *   "N-M/S"   → range with step
 */
export function parseCronField(field: string, min: number, max: number): number[] {
  const results = new Set<number>();

  // Handle comma-separated list first — each part is parsed independently
  const parts = field.split(",");
  for (const part of parts) {
    const trimmed = part.trim();

    if (trimmed.includes("/")) {
      // Step: */N  or  N-M/S
      const slashParts = trimmed.split("/");
      const rangePart = slashParts[0] ?? "*";
      const stepStr = slashParts[1] ?? "1";
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value in cron field: ${field}`);
      }

      let start: number;
      let end: number;

      if (rangePart === "*") {
        start = min;
        end = max;
      } else if (rangePart.includes("-")) {
        const dashParts = rangePart.split("-");
        start = parseInt(dashParts[0] ?? "0", 10);
        end = parseInt(dashParts[1] ?? "0", 10);
      } else {
        // Single number with step — treat as start with step through max
        start = parseInt(rangePart, 10);
        end = max;
      }

      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) results.add(i);
      }
    } else if (trimmed === "*") {
      for (let i = min; i <= max; i++) {
        results.add(i);
      }
    } else if (trimmed.includes("-")) {
      // Range: N-M
      const dashParts = trimmed.split("-");
      const lo = parseInt(dashParts[0] ?? "0", 10);
      const hi = parseInt(dashParts[1] ?? "0", 10);
      if (isNaN(lo) || isNaN(hi)) {
        throw new Error(`Invalid range in cron field: ${field}`);
      }
      for (let i = lo; i <= hi; i++) {
        if (i >= min && i <= max) results.add(i);
      }
    } else {
      // Exact value
      const val = parseInt(trimmed, 10);
      if (isNaN(val)) {
        throw new Error(`Invalid value in cron field: ${field}`);
      }
      if (val >= min && val <= max) results.add(val);
    }
  }

  return Array.from(results).sort((a, b) => a - b);
}

export interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

/**
 * Parse a standard 5-field cron expression.
 *
 * Fields: minute hour day-of-month month day-of-week
 */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expression}": expected 5 fields, got ${fields.length}`
    );
  }

  return {
    minutes: parseCronField(fields[0]!, 0, 59),
    hours: parseCronField(fields[1]!, 0, 23),
    daysOfMonth: parseCronField(fields[2]!, 1, 31),
    months: parseCronField(fields[3]!, 1, 12),
    daysOfWeek: parseCronField(fields[4]!, 0, 6),
  };
}

/**
 * Check whether a given Date matches a cron expression.
 */
export function shouldRunAt(cronExpression: string, date: Date): boolean {
  const cron = parseCron(cronExpression);

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // JS months are 0-based
  const dayOfWeek = date.getDay(); // 0 = Sunday

  return (
    cron.minutes.includes(minute) &&
    cron.hours.includes(hour) &&
    cron.daysOfMonth.includes(dayOfMonth) &&
    cron.months.includes(month) &&
    cron.daysOfWeek.includes(dayOfWeek)
  );
}

/**
 * Find the next Date that matches the cron expression, searching minute by
 * minute from `after` (defaults to now) up to 366 days ahead.
 */
export function getNextRunTime(cronExpression: string, after?: Date): Date {
  // Validate the expression upfront
  parseCron(cronExpression);

  const start = after ? new Date(after.getTime()) : new Date();
  // Advance to the next whole minute
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const maxDate = new Date(start.getTime() + 366 * 24 * 60 * 60 * 1000);

  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= maxDate.getTime()) {
    if (shouldRunAt(cronExpression, cursor)) {
      return cursor;
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  throw new Error(
    `No matching time found for cron expression "${cronExpression}" within 366 days`
  );
}

// ─── Scheduler Events ───────────────────────────────────────────────────────

export interface SchedulerEvent {
  type: "schedule:triggered" | "schedule:completed" | "schedule:failed";
  scheduleId: string;
  scheduleName: string;
  runId?: string;
  error?: string;
  timestamp: string;
}

// ─── Scheduler Class ────────────────────────────────────────────────────────

export class Scheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = new Set<string>();
  private checkIntervalMs: number;
  private onEvent?: (event: SchedulerEvent) => void;

  constructor(options?: {
    checkIntervalMs?: number;
    onEvent?: (event: SchedulerEvent) => void;
  }) {
    this.checkIntervalMs = options?.checkIntervalMs ?? 60_000;
    this.onEvent = options?.onEvent;
  }

  /**
   * Start the scheduler — runs tick() at the configured interval.
   */
  start(): void {
    if (this.interval) return; // already running
    // Run an initial tick immediately, then schedule recurring checks
    this.tick().catch(() => {});
    this.interval = setInterval(() => {
      this.tick().catch(() => {});
    }, this.checkIntervalMs);
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * A single tick: check all enabled schedules and trigger any that are due.
   */
  async tick(): Promise<void> {
    const now = new Date();
    // Zero out seconds/ms so we compare at minute granularity
    now.setSeconds(0, 0);

    const schedules = getEnabledSchedules();

    for (const schedule of schedules) {
      if (this.running.has(schedule.id)) continue;

      if (shouldRunAt(schedule.cronExpression, now)) {
        this.running.add(schedule.id);

        this.emit({
          type: "schedule:triggered",
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          timestamp: new Date().toISOString(),
        });

        // Run in background — don't block the tick loop
        this.executeSchedule(schedule)
          .then(({ runId }) => {
            const nextRun = getNextRunTime(schedule.cronExpression, new Date());
            updateLastRun(schedule.id, runId, nextRun.toISOString());

            this.emit({
              type: "schedule:completed",
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              runId,
              timestamp: new Date().toISOString(),
            });
          })
          .catch((err) => {
            this.emit({
              type: "schedule:failed",
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              error: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            });
          })
          .finally(() => {
            this.running.delete(schedule.id);
          });
      }
    }
  }

  /**
   * Manually trigger a schedule immediately (e.g. `testers schedule run <id>`).
   */
  async runScheduleNow(scheduleId: string): Promise<void> {
    const schedule = getSchedule(scheduleId);
    if (!schedule) {
      throw new ScheduleNotFoundError(scheduleId);
    }

    this.running.add(schedule.id);

    this.emit({
      type: "schedule:triggered",
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      timestamp: new Date().toISOString(),
    });

    try {
      const { runId } = await this.executeSchedule(schedule);
      const nextRun = getNextRunTime(schedule.cronExpression, new Date());
      updateLastRun(schedule.id, runId, nextRun.toISOString());

      this.emit({
        type: "schedule:completed",
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        runId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.emit({
        type: "schedule:failed",
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
      throw err;
    } finally {
      this.running.delete(schedule.id);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private async executeSchedule(
    schedule: Schedule
  ): Promise<{ runId: string }> {
    const { run } = await runByFilter({
      url: schedule.url,
      model: schedule.model ?? undefined,
      headed: schedule.headed,
      parallel: schedule.parallel,
      timeout: schedule.timeoutMs ?? undefined,
      tags: schedule.scenarioFilter.tags,
      priority: schedule.scenarioFilter.priority,
      scenarioIds: schedule.scenarioFilter.scenarioIds,
    });

    return { runId: run.id };
  }

  private emit(event: SchedulerEvent): void {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}
