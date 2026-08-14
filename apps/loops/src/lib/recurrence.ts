import type { CatchUpPolicy, Loop, ScheduleSpec } from "../types.js";

function assertDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${label}: ${value}`);
  return date;
}

function parseField(expr: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of expr.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) throw new Error(`invalid cron step: ${part}`);
    let lo = min;
    let hi = max;
    if (rangePart && rangePart !== "*") {
      const bounds = rangePart.split("-");
      if (bounds.length === 1) {
        lo = hi = Number(bounds[0]);
      } else if (bounds.length === 2) {
        lo = Number(bounds[0]);
        hi = Number(bounds[1]);
      } else {
        throw new Error(`invalid cron range: ${part}`);
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`invalid cron field: ${part}`);
    }
    for (let v = lo; v <= hi; v += step) {
      if (v < min || v > max) throw new Error(`cron value out of range: ${v} in ${expr}`);
      out.add(v);
    }
  }
  return out;
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const MINUTE_MS = 60_000;
const PARSED_CRON_CACHE_LIMIT = 256;
const parsedCronCache = new Map<string, ParsedCron>();

const emittedScheduleWarnings = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (emittedScheduleWarnings.has(key)) return;
  emittedScheduleWarnings.add(key);
  console.warn(`[loops] WARN ${message}`);
}

export function parseCron(expr: string): ParsedCron {
  const cached = parsedCronCache.get(expr);
  if (cached) return cached;
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron must have 5 fields, got ${fields.length}: "${expr}"`);
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const dowSet = parseField(dow, 0, 7);
  if (dowSet.has(7)) {
    dowSet.delete(7);
    dowSet.add(0);
  }
  const parsed: ParsedCron = {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(month, 1, 12),
    dow: dowSet,
    domRestricted: dom !== "*",
    dowRestricted: dow !== "*",
  };
  if (parsedCronCache.size >= PARSED_CRON_CACHE_LIMIT) {
    const oldest = parsedCronCache.keys().next().value;
    if (oldest !== undefined) parsedCronCache.delete(oldest);
  }
  parsedCronCache.set(expr, parsed);
  return parsed;
}

function cronMatches(cron: ParsedCron, date: Date): boolean {
  if (!cron.minute.has(date.getMinutes())) return false;
  if (!cron.hour.has(date.getHours())) return false;
  if (!cron.month.has(date.getMonth() + 1)) return false;
  const domOk = cron.dom.has(date.getDate());
  const dowOk = cron.dow.has(date.getDay());
  if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
  if (cron.domRestricted) return domOk;
  if (cron.dowRestricted) return dowOk;
  return true;
}

export function nextCronRun(expr: string, from: Date): Date {
  const cron = parseCron(expr);
  const date = new Date(from.getTime());
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (date.getTime() <= limit) {
    if (cronMatches(cron, date)) return date;
    date.setMinutes(date.getMinutes() + 1);
  }
  throw new Error(`no cron match within one year for: ${expr}`);
}

export function initialNextRun(schedule: ScheduleSpec, from: Date = new Date()): string {
  switch (schedule.type) {
    case "once":
      return assertDate(schedule.at, "schedule.at").toISOString();
    case "interval":
      if (!Number.isFinite(schedule.everyMs) || schedule.everyMs <= 0) throw new Error("interval everyMs must be > 0");
      return new Date(from.getTime() + schedule.everyMs).toISOString();
    case "cron":
      return nextCronRun(schedule.expression, from).toISOString();
    case "dynamic":
      return new Date(from.getTime() + (schedule.minIntervalMs ?? 60_000)).toISOString();
  }
}

export function computeNextAfter(schedule: ScheduleSpec, scheduledFor: Date, finishedAt: Date): string | undefined {
  switch (schedule.type) {
    case "once":
      return undefined;
    case "interval": {
      const anchor = schedule.anchor ?? "fixed_rate";
      const base = anchor === "fixed_delay" ? finishedAt : scheduledFor;
      let next = new Date(base.getTime() + schedule.everyMs);
      while (next.getTime() <= finishedAt.getTime()) next = new Date(next.getTime() + schedule.everyMs);
      return next.toISOString();
    }
    case "cron": {
      let next = nextCronRun(schedule.expression, scheduledFor);
      while (next.getTime() <= finishedAt.getTime()) next = nextCronRun(schedule.expression, next);
      return next.toISOString();
    }
    case "dynamic":
      return new Date(finishedAt.getTime() + (schedule.minIntervalMs ?? 60_000)).toISOString();
  }
}

function latestIntervalSlot(first: Date, now: Date, everyMs: number): Date {
  if (first.getTime() > now.getTime()) return first;
  const steps = Math.floor((now.getTime() - first.getTime()) / everyMs);
  return new Date(first.getTime() + steps * everyMs);
}

function floorToMinute(date: Date): Date {
  const floored = new Date(date.getTime());
  floored.setSeconds(0, 0);
  return floored;
}

// nextCronRun guarantees a match within 366 days, so scanning further back can
// never succeed; this bounds the backward scan for restricted patterns.
const LATEST_CRON_SCAN_LIMIT_MINUTES = 366 * 24 * 60;

/**
 * Latest matching slot <= now for crons restricted only by minute/hour
 * (dom/dow/month unrestricted). Such patterns match every day, so the latest
 * slot is computed arithmetically instead of walking the gap minute by minute.
 */
function latestDailyCronSlot(cron: ParsedCron, now: Date): Date {
  const hoursDesc = [...cron.hour].sort((a, b) => b - a);
  const minutesDesc = [...cron.minute].sort((a, b) => b - a);
  const candidate = floorToMinute(now);
  for (let dayOffset = 0; dayOffset < 2; dayOffset += 1) {
    const isToday = dayOffset === 0;
    for (const hour of hoursDesc) {
      if (isToday && hour > now.getHours()) continue;
      const minuteCap = isToday && hour === now.getHours() ? now.getMinutes() : 59;
      const minute = minutesDesc.find((value) => value <= minuteCap);
      if (minute === undefined) continue;
      candidate.setHours(hour, minute, 0, 0);
      return candidate;
    }
    candidate.setDate(candidate.getDate() - 1);
  }
  throw new Error("unreachable: daily cron pattern must match within two days");
}

function latestCronSlot(first: Date, now: Date, expression: string): Date {
  if (first.getTime() > now.getTime()) return first;
  const cron = parseCron(expression);
  if (!cron.domRestricted && !cron.dowRestricted && cron.month.size === 12) {
    const latest = latestDailyCronSlot(cron, now);
    return latest.getTime() >= first.getTime() ? latest : first;
  }
  // Restricted patterns: bounded backward scan from now instead of chaining
  // nextCronRun forward from first, so a year-long gap cannot spin the event
  // loop proportionally to the number of missed slots.
  const scanFloorMs = Math.max(first.getTime(), now.getTime() - LATEST_CRON_SCAN_LIMIT_MINUTES * MINUTE_MS);
  const cursor = floorToMinute(now);
  while (cursor.getTime() >= scanFloorMs) {
    if (cronMatches(cron, cursor)) return cursor;
    cursor.setMinutes(cursor.getMinutes() - 1);
  }
  if (first.getTime() < scanFloorMs) {
    warnOnce(
      `latest-cron:${expression}`,
      `latestCronSlot: no match for "${expression}" within the ${LATEST_CRON_SCAN_LIMIT_MINUTES}-minute scan window; using the stored next run as the latest slot`,
    );
  }
  return first;
}

export interface DuePlan {
  slots: string[];
  skippedToNextRunAt?: string;
}

// Hard cap on catch-up slots materialized per plan, so a huge catchUpLimit
// combined with a long gap cannot spin the event loop in a single tick.
export const MAX_CATCH_UP_SLOTS = 1_000;

function catchUpSlotLimit(loop: Loop): number {
  if (loop.catchUpLimit > MAX_CATCH_UP_SLOTS) {
    warnOnce(
      `catch-up-limit:${loop.id}`,
      `dueSlots: loop ${loop.id} catchUpLimit ${loop.catchUpLimit} exceeds the per-plan cap; using ${MAX_CATCH_UP_SLOTS}`,
    );
    return MAX_CATCH_UP_SLOTS;
  }
  return loop.catchUpLimit;
}

export function dueSlots(loop: Loop, now: Date): DuePlan {
  if (!loop.nextRunAt || loop.status !== "active") return { slots: [] };
  if (loop.expiresAt && new Date(loop.expiresAt).getTime() <= now.getTime()) return { slots: [] };
  const next = assertDate(loop.nextRunAt, "loop.nextRunAt");
  if (next.getTime() > now.getTime()) return { slots: [] };
  if (loop.retryScheduledFor) return { slots: [loop.retryScheduledFor] };

  const catchUp: CatchUpPolicy = loop.catchUp;
  switch (loop.schedule.type) {
    case "once":
    case "dynamic":
      return { slots: [next.toISOString()] };
    case "interval": {
      if (catchUp === "all") {
        const limit = catchUpSlotLimit(loop);
        const slots: string[] = [];
        let cursor = next;
        while (cursor.getTime() <= now.getTime() && slots.length < limit) {
          slots.push(cursor.toISOString());
          cursor = new Date(cursor.getTime() + loop.schedule.everyMs);
        }
        return { slots };
      }
      if (catchUp === "latest") return { slots: [latestIntervalSlot(next, now, loop.schedule.everyMs).toISOString()] };
      return { slots: [next.toISOString()] };
    }
    case "cron": {
      if (catchUp === "all") {
        const limit = catchUpSlotLimit(loop);
        const slots: string[] = [];
        let cursor = next;
        while (cursor.getTime() <= now.getTime() && slots.length < limit) {
          slots.push(cursor.toISOString());
          cursor = nextCronRun(loop.schedule.expression, cursor);
        }
        return { slots };
      }
      if (catchUp === "latest") return { slots: [latestCronSlot(next, now, loop.schedule.expression).toISOString()] };
      return { slots: [next.toISOString()] };
    }
  }
}

export function parseDuration(input: string): number {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/);
  if (!match) throw new Error(`invalid duration: ${input}`);
  const value = Number(match[1]);
  const unit = match[2] ?? "ms";
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return Math.round(value * multiplier);
}
