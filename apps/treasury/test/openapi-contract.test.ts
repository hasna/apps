import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { openApiDocument } from "../src/api/index.js";

describe("openapi contract", () => {
  it("checked-in openapi.json matches the generated document", () => {
    const onDisk = JSON.parse(readFileSync("openapi.json", "utf8"));
    expect(onDisk).toEqual(openApiDocument());
  });

  it("declares the /v1 resources and system endpoints", () => {
    const doc = openApiDocument();
    for (const p of ["/health", "/ready", "/version", "/v1/entities", "/v1/balances", "/v1/exposure", "/v1/runway", "/v1/forecast", "/v1/sweeps", "/v1/fx-rates", "/v1/cost-feeds"]) {
      expect(doc.paths).toHaveProperty(p);
    }
  });
});
