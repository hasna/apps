import { describe, expect, test } from "bun:test";
import { DatasetQuerySchema, JsonValueSchema } from "./schemas.js";

describe("dataset query contracts", () => {
  test("applies safe defaults for omitted pagination and redaction", () => {
    expect(DatasetQuerySchema.parse({})).toEqual({
      limit: 20,
      offset: 0,
      redact: true,
    });
  });

  test("rejects zero, negative, and over-cap limits", () => {
    for (const limit of [0, -1, 501]) {
      expect(() => DatasetQuerySchema.parse({ limit })).toThrow();
    }
    expect(DatasetQuerySchema.parse({ limit: 500 }).limit).toBe(500);
  });

  test("accepts nested JSON values but rejects unsupported values", () => {
    const value = { filters: { tags: ["a", null, { active: true }] } };
    expect(JsonValueSchema.parse(value)).toEqual(value);
    expect(() => JsonValueSchema.parse({ bad: undefined })).toThrow();
  });
});
