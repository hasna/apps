import { describe, expect, test } from "bun:test";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { buildV1OpenApiDocument } from "./openapi.js";

describe("OpenAPI document isolation", () => {
  test("one consumer cannot corrupt a later SDK generation", () => {
    const first = buildV1OpenApiDocument("first") as Record<string, any>;
    const second = buildV1OpenApiDocument("second") as Record<string, any>;

    expect(first.components.schemas.Task).not.toBe(second.components.schemas.Task);

    Object.defineProperty(first.components.schemas.Task, "required", {
      configurable: true,
      get() {
        throw new TypeError("poisoned schema from an earlier consumer");
      },
    });

    expect(() => generateSdkFromOpenApi(second as never)).not.toThrow();
  });
});
