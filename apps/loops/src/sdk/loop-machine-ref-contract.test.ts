import { describe, expect, test } from "bun:test";
import openApi from "../../openapi/loops.json" with { type: "json" };

// Regression lock for O15-00172 review finding: LoopMachineRef.confidence was
// mis-typed as `number` in the OpenAPI component and therefore in the
// regenerated SDK, while the runtime value is the string enum
// LoopMachineConfidence ("exact" | "high" | "medium" | "low" | "none") —
// apps/loops/src/types.ts and the machines consumer contract
// (apps/machines/src/consumer-schema.ts) both agree. The value flows through
// untouched (machineFromRoute -> LoopMachineRef -> publicLoop), so the wire
// type must match the runtime type exactly.
const MACHINE_CONFIDENCE_ENUM = ["exact", "high", "medium", "low", "none"];

function loopMachineRefSchema(): { properties?: Record<string, unknown> } {
  const spec = openApi as {
    components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
  };
  const component = spec.components?.schemas?.LoopMachineRef;
  if (!component) throw new Error("openapi must declare a LoopMachineRef schema");
  return component;
}

describe("LoopMachineRef confidence contract", () => {
  test("openapi declares confidence as the string enum, never a number", () => {
    const schema = loopMachineRefSchema();
    expect(schema.properties?.confidence).toEqual({ type: "string", enum: MACHINE_CONFIDENCE_ENUM });
  });

  test("generated SDK carries the string-union confidence type", async () => {
    // The SDK at src/sdk/http.ts is generated from openapi/loops.json by
    // scripts/gen-sdk.ts; the generator renders a `{type: string, enum}` schema
    // as a TS string union. A numeric mis-type in the spec would regenerate to
    // `"confidence"?: number` — assert it cannot.
    const source = await Bun.file(new URL("./http.ts", import.meta.url)).text();
    const line = source.split("\n").find((l) => l.includes("export interface LoopMachineRef"));
    expect(line, "generated SDK must declare LoopMachineRef").toBeDefined();
    expect(line).toContain('"confidence"?: "exact" | "high" | "medium" | "low" | "none"');
    expect(line).not.toContain('"confidence"?: number');
  });
});
