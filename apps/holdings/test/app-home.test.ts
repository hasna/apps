import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHoldingsAppHome, getHoldingsAppHome, HOLDINGS_APP_SUBDIRS } from "../src/core/app-home.js";

let tmp: string;
let saved: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "holdings-home-"));
  saved = process.env["HASNA_HOLDINGS_HOME"];
  process.env["HASNA_HOLDINGS_HOME"] = join(tmp, "holdings");
});
afterEach(() => {
  if (saved === undefined) delete process.env["HASNA_HOLDINGS_HOME"];
  else process.env["HASNA_HOLDINGS_HOME"] = saved;
  rmSync(tmp, { recursive: true, force: true });
});

describe("app home", () => {
  it("creates all subdirs with mode 0700", () => {
    const dirs = ensureHoldingsAppHome();
    expect(dirs.root).toBe(getHoldingsAppHome());
    for (const sub of HOLDINGS_APP_SUBDIRS) {
      const st = statSync(dirs[sub]);
      expect(st.isDirectory()).toBe(true);
      expect(st.mode & 0o777).toBe(0o700);
    }
  });
});
