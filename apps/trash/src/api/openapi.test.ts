import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { VERSION } from "../version.js";
test("published API contract covers hosted capture, recovery and Backup with authenticated bounded reads", () => {
  const doc = JSON.parse(readFileSync(new URL("../../openapi.json", import.meta.url), "utf8"));
  expect(doc.info.version).toBe(VERSION);
  expect(doc.paths["/v1/entries"].get.parameters.find((p: {name: string}) => p.name === "limit").schema.maximum).toBe(100);
  for (const action of ["upload", "verify", "commit", "hold", "retention", "restore", "restore/complete", "backup", "backup/claim", "backup/complete", "backup/fail"]) {
    const operation = doc.paths[`/v1/entries/{id}/${action}`].post;
    expect(operation.parameters.some((p: {$ref: string}) => p.$ref === "#/components/parameters/IfMatch")).toBe(true);
    expect(operation.parameters.some((p: {$ref: string}) => p.$ref === "#/components/parameters/IdempotencyKey")).toBe(true);
    expect(operation.responses["200"]).toBeDefined();
  }
  expect(doc.security).toEqual([{ bearerAuth: [] }]); expect(doc.paths["/health"].get.security).toEqual([]);
});
