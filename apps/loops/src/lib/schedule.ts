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

export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron must have 5 fields, got ${fields.length}: "${expr}"`);
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const dowSet = parseField(dow, 0, 7);
  if (dowSet.has(7)) {
    dowSet.delete(7);
    dowSet.add(0);
  }
  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(month, 1, 12),
    dow: dowSet,
    domRestricted: dom !== "*",
    dowRestricted: dow !== "*",
  };
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

function latestCronSlot(first: Date, now: Date, expression: string): Date {
  let current = first;
  while (true) {
    const next = nextCronRun(expression, current);
    if (next.getTime() > now.getTime()) return current;
    current = next;
  }
}

export interface DuePlan {
  slots: string[];
  skippedToNextRunAt?: string;
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
        const slots: string[] = [];
        let cursor = next;
        while (cursor.getTime() <= now.getTime() && slots.length < loop.catchUpLimit) {
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
        const slots: string[] = [];
        let cursor = next;
        while (cursor.getTime() <= now.getTime() && slots.length < loop.catchUpLimit) {
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
