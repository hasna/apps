import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generate } from "./generate-intake-sdk.js";

test("the actual typed route client is reproducible from the served OpenAPI",()=>{
  const source=readFileSync(resolve(import.meta.dir,"../src/intake/generated.ts"),"utf8");
  expect(source).toBe(generate());
  for(const operation of ["acceptEvent","intakeCapability","readReceipt"])expect(source).toContain(`export function ${operation}`);
  const wrapper=readFileSync(resolve(import.meta.dir,"../src/intake/client.ts"),"utf8");
  expect(wrapper).toContain('from "./generated.js"');
  expect(wrapper).toContain('createClientTransport("events"');
  expect(source).not.toContain("resolveCredential");
});
