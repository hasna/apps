/**
 * License conformance — standard-adherence suite, check 4.
 *
 * The org standard is Apache-2.0 (repo law / org convention). Recorded
 * exceptions carry the measured license and reason.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APPS_DIR, membersIn, LICENSE_EXCEPTIONS } from "./census";

const exceptionByMember = () => new Map(LICENSE_EXCEPTIONS.map((e) => [e.member, e]));

export function licenseViolations(appsDir: string = APPS_DIR): string[] {
  const out: string[] = [];
  const ex = exceptionByMember();
  for (const m of membersIn(appsDir)) {
    if (!m.publishable) continue;
    if (m.license === "Apache-2.0") {
      if (ex.has(m.name)) out.push(`${m.name}: license is Apache-2.0 but a recorded exception exists — remove the entry`);
      continue;
    }
    const entry = ex.get(m.name);
    if (!entry) {
      out.push(`${m.name}: license=${m.license || "(missing)"} (expected Apache-2.0)`);
    } else if (entry.license !== m.license) {
      out.push(`${m.name}: recorded exception says ${entry.license} but package.json says ${m.license}`);
    }
  }
  return out;
}

describe("standard-adherence: license", () => {
  test("every publishable member declares license Apache-2.0 (recorded exceptions allowed)", () => {
    const violations = licenseViolations();
    expect(violations, `license violations:\n${violations.join("\n")}`).toEqual([]);
  });

  test("self-test: the check fires on a non-Apache license and stays silent on Apache", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standard-license-self-test-"));
    try {
      const apps = path.join(root, "apps");
      fs.mkdirSync(path.join(apps, "ok"), { recursive: true });
      fs.mkdirSync(path.join(apps, "mit"), { recursive: true });
      fs.mkdirSync(path.join(apps, "none"), { recursive: true });
      fs.writeFileSync(path.join(apps, "ok", "package.json"), JSON.stringify({ name: "@hasna/ok", license: "Apache-2.0" }, null, 2));
      fs.writeFileSync(path.join(apps, "mit", "package.json"), JSON.stringify({ name: "@hasna/mit", license: "MIT" }, null, 2));
      fs.writeFileSync(path.join(apps, "none", "package.json"), JSON.stringify({ name: "@hasna/none" }, null, 2));
      const v = licenseViolations(apps);
      expect(v.some((x) => x.startsWith("mit"))).toBe(true);
      expect(v.some((x) => x.startsWith("none"))).toBe(true);
      expect(v.some((x) => x.startsWith("ok"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
