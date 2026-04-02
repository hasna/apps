import { describe, expect, test } from "bun:test";
import { requireDeleteConfirmation } from "./projects.js";

describe("requireDeleteConfirmation", () => {
  test("throws when --yes is not provided", () => {
    expect(() => requireDeleteConfirmation(false)).toThrow("Project deletion requires --yes confirmation");
    expect(() => requireDeleteConfirmation(undefined)).toThrow("Project deletion requires --yes confirmation");
  });

  test("does not throw when --yes is provided", () => {
    expect(() => requireDeleteConfirmation(true)).not.toThrow();
  });
});
