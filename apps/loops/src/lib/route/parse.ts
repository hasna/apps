import { parseDuration } from "../recurrence.js";
import { ValidationError } from "../errors.js";

export function positiveInteger(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ValidationError(`${label} must be a positive integer`);
  return value;
}

export function nonNegativeInteger(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new ValidationError(`${label} must be a non-negative integer`);
  return value;
}

export function positiveDuration(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = parseDuration(raw);
  if (!Number.isFinite(value) || value <= 0) throw new ValidationError(`${label} must be greater than zero`);
  return value;
}

export function timeoutDuration(raw: string | undefined, label: string): number | null | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (["none", "unlimited", "null", "never", "off", "false"].includes(normalized)) return null;
  const value = parseDuration(raw);
  if (!Number.isFinite(value) || value <= 0) throw new ValidationError(`${label} must be a duration greater than zero, or none/unlimited`);
  return value;
}

export function idleTimeoutDuration(raw: string | undefined, label: string): number | undefined {
  const value = timeoutDuration(raw, label);
  return value === null ? undefined : value;
}

export function splitList(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values?.length ? values : undefined;
}

export function listFromRepeatedOpts(value: string[] | undefined): string[] | undefined {
  const values = (value ?? []).flatMap((entry) => splitList(entry) ?? []);
  return values.length ? values : undefined;
}

export function collectValues(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}
