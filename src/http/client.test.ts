import { describe, expect, test } from "bun:test";
import { HasnaHttpError } from "./client.js";

describe("HasnaHttpError", () => {
  test("surfaces a bounded structured server error", () => {
    const detail = `typed resource-link validation: ${"x".repeat(600)}`;
    const error = new HasnaHttpError("PATCH", "/v1/projects/wks_test", 400, {
      error: detail,
    });

    expect(error.message).toStartWith(
      "Hasna request failed: PATCH /v1/projects/wks_test -> 400: typed resource-link validation:",
    );
    expect(error.message).toEndWith("...");
    expect(error.message).not.toContain(detail);
  });

  test("keeps the generic message for response bodies without an error string", () => {
    const error = new HasnaHttpError("GET", "/v1/projects", 502, {
      message: "upstream unavailable",
    });

    expect(error.message).toBe("Hasna request failed: GET /v1/projects -> 502");
  });
});
