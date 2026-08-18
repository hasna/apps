import { describe, expect, test } from "bun:test";
import { emailsApiOpenApi } from "../server/api/openapi.js";
import { ROUTES } from "./routes.js";

describe("HTTP priority sender rule routes", () => {
  test("keeps immutable priority rules off the PATCH surface", () => {
    expect(
      ROUTES.some(
        (route) => route.method === "PATCH" && route.template === "/v1/priority-sender-rules/{id}",
      ),
    ).toBe(false);
    const priorityPath = emailsApiOpenApi.paths["/v1/priority-sender-rules/{id}"] as
      | Record<string, unknown>
      | undefined;
    expect(priorityPath?.patch).toBeUndefined();
  });
});
