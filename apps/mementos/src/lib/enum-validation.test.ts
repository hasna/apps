import { describe, expect, test } from "bun:test";
import { validateEnumField, validateMemoryEnums, formatEnumViolation } from "./enum-validation.js";
import {
  MEMORY_CATEGORIES,
  MEMORY_SCOPES,
  MEMORY_SOURCES,
  MEMORY_STATUSES,
} from "../types/index.js";

describe("enum validation", () => {
  test("rejects the category that caused the incident and names the alternatives", () => {
    const v = validateEnumField("category", "decision");
    expect(v).not.toBeNull();
    expect(v!.field).toBe("category");
    expect(v!.value).toBe("decision");
    expect(formatEnumViolation(v!)).toBe(
      'Invalid category: "decision". Allowed values: preference, fact, knowledge, history, procedural, resource.',
    );
  });

  test.each(MEMORY_CATEGORIES)("accepts canonical category %s", (c) => {
    expect(validateEnumField("category", c)).toBeNull();
  });

  test.each(MEMORY_SCOPES)("accepts canonical scope %s", (s) => {
    expect(validateEnumField("scope", s)).toBeNull();
  });

  test.each(MEMORY_SOURCES)("accepts canonical source %s", (s) => {
    expect(validateEnumField("source", s)).toBeNull();
  });

  test.each(MEMORY_STATUSES)("accepts canonical status %s", (s) => {
    expect(validateEnumField("status", s)).toBeNull();
  });

  test("absent or empty means 'use the default', not a violation", () => {
    expect(validateEnumField("category", undefined)).toBeNull();
    expect(validateEnumField("category", null)).toBeNull();
    expect(validateEnumField("category", "")).toBeNull();
  });

  test("non-enum columns are not policed here", () => {
    expect(validateEnumField("value", "anything at all")).toBeNull();
  });

  test("a non-string value is still a violation, not a crash", () => {
    const v = validateEnumField("category", 42);
    expect(v).not.toBeNull();
    expect(v!.value).toBe("42");
  });

  test("validateMemoryEnums scans a whole payload and reports the offender", () => {
    expect(validateMemoryEnums({ key: "k", value: "v" })).toBeNull();
    expect(validateMemoryEnums({ key: "k", value: "v", category: "knowledge" })).toBeNull();
    const v = validateMemoryEnums({ key: "k", value: "v", scope: "public" });
    expect(v!.field).toBe("scope");
  });

  test("a field only counts when present — an absent key is not a violation", () => {
    expect(validateMemoryEnums({ key: "k" })).toBeNull();
  });

  test("rejects a near-miss value for every database-constrained enum field", () => {
    const cases = [
      ["category", MEMORY_CATEGORIES, "facts"],
      ["scope", MEMORY_SCOPES, "shared-ish"],
      ["source", MEMORY_SOURCES, "manual-ish"],
      ["status", MEMORY_STATUSES, "active-ish"],
    ] as const;

    for (const [field, allowed, value] of cases) {
      const violation = validateEnumField(field, value);
      expect(violation).toEqual({ field, value, allowed });
      expect(formatEnumViolation(violation!)).toBe(
        `Invalid ${field}: "${value}". Allowed values: ${allowed.join(", ")}.`,
      );
    }
  });

  test("reports the first invalid field in canonical order regardless of payload order", () => {
    const violation = validateMemoryEnums({
      status: "active-ish",
      source: "manual-ish",
      scope: "shared-ish",
      category: "facts",
    });

    expect(violation).toEqual({
      field: "category",
      value: "facts",
      allowed: MEMORY_CATEGORIES,
    });
  });
});
