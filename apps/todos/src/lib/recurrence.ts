// Recurrence rule parser and next-date calculator
// Supports: "every day", "every weekday", "every week", "every 2 weeks",
// "every month", "every N days/weeks/months", "every monday",
// "every mon,wed,fri", "every 3 months"

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export interface ParsedRule {
  type: "interval" | "weekdays" | "specific_days";
  interval?: number;
  unit?: "day" | "week" | "month";
  days?: number[]; // 0=Sunday, 1=Monday, etc.
}

export function parseRecurrenceRule(rule: string): ParsedRule {
  const normalized = rule.trim().toLowerCase();

  // "every weekday" or "every weekdays"
  if (normalized === "every weekday" || normalized === "every weekdays") {
    return { type: "specific_days", days: [1, 2, 3, 4, 5] };
  }

  // "every day" or "daily"
  if (normalized === "every day" || normalized === "daily") {
    return { type: "interval", interval: 1, unit: "day" };
  }

  // "every week" or "weekly"
  if (normalized === "every week" || normalized === "weekly") {
    return { type: "interval", interval: 1, unit: "week" };
  }

  // "every month" or "monthly"
  if (normalized === "every month" || normalized === "monthly") {
    return { type: "interval", interval: 1, unit: "month" };
  }

  // "every N days/weeks/months"
  const intervalMatch = normalized.match(/^every\s+(\d+)\s+(day|week|month)s?$/);
  if (intervalMatch) {
    return {
      type: "interval",
      interval: parseInt(intervalMatch[1]!, 10),
      unit: intervalMatch[2]! as "day" | "week" | "month",
    };
  }

  // "every monday" or "every mon,wed,fri" or "every tuesday,thursday"
  const daysMatch = normalized.match(/^every\s+(.+)$/);
  if (daysMatch) {
    const dayParts = daysMatch[1]!.split(/[,\s]+/).map(d => d.trim()).filter(Boolean);
    const days: number[] = [];
    for (const part of dayParts) {
      const dayNum = DAY_NAMES[part];
      if (dayNum !== undefined) {
        days.push(dayNum);
      }
    }
    if (days.length > 0) {
      return { type: "specific_days", days: days.sort((a, b) => a - b) };
    }
  }

  throw new Error(
    `Invalid recurrence rule: "${rule}". Supported formats: "every day", "every weekday", "every week", "every 2 weeks", "every month", "every N days/weeks/months", "every monday", "every mon,wed,fri"`,
  );
}

export function isValidRecurrenceRule(rule: string): boolean {
  try {
    parseRecurrenceRule(rule);
    return true;
  } catch {
    return false;
  }
}

export function nextOccurrence(rule: string, from?: Date): string {
  const parsed = parseRecurrenceRule(rule);
  const base = from || new Date();

  if (parsed.type === "interval") {
    const next = new Date(base);
    if (parsed.unit === "day") {
      next.setDate(next.getDate() + parsed.interval!);
    } else if (parsed.unit === "week") {
      next.setDate(next.getDate() + parsed.interval! * 7);
    } else if (parsed.unit === "month") {
      next.setMonth(next.getMonth() + parsed.interval!);
    }
    return next.toISOString();
  }

  if (parsed.type === "specific_days") {
    const currentDay = base.getDay();
    const days = parsed.days!;

    // Find the next day that's after today
    let daysToAdd = Infinity;
    for (const day of days) {
      let diff = day - currentDay;
      if (diff <= 0) diff += 7; // wrap to next week
      if (diff < daysToAdd) daysToAdd = diff;
    }

    const next = new Date(base);
    next.setDate(next.getDate() + daysToAdd);
    return next.toISOString();
  }

  throw new Error(`Cannot calculate next occurrence for rule: "${rule}"`);
}
