import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Pinned cap (§3.6): no non-test src file may exceed 700 lines. Split, do not raise.
const MAX_PRODUCTION_LOC = 700;

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if ((full.endsWith(".ts") || full.endsWith(".tsx")) && !full.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("file size cap", () => {
  it(`keeps every non-test src file <= ${MAX_PRODUCTION_LOC} lines`, () => {
    const offenders: Array<{ file: string; lines: number }> = [];
    for (const file of collect("src")) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
      if (lines > MAX_PRODUCTION_LOC) offenders.push({ file, lines });
    }
    expect(offenders).toEqual([]);
  });
});
