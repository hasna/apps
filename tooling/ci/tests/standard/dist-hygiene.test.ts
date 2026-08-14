/**
 * dist hygiene — standard-adherence suite, check 5.
 *
 * Where a member declares a `files` field, no entry may pull stray build
 * artifacts into the published tarball: `node_modules` INCLUSION entries
 * are violations; a `!`-negated exclusion entry (a node_modules glob with
 * a leading `!`, as in apps/skills) is the sanctioned way to prune and is
 * not a violation. A missing `dist` directory in the source tree is the
 * normal PRE-build state (turbo build produces it) and is NOT a violation —
 * the tarball only exists after build.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APPS_DIR, membersIn } from "./census";

export function distHygieneViolations(appsDir: string = APPS_DIR): string[] {
  const out: string[] = [];
  for (const m of membersIn(appsDir)) {
    if (!m.publishable || !m.hasFilesField) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(appsDir, m.name, "package.json"), "utf8")) as { files?: string[] };
    for (const entry of pkg.files ?? []) {
      if (/node_modules/.test(entry) && !entry.startsWith("!")) {
        out.push(`${m.name}: files entry "${entry}" INCLUDES node_modules (use a !-negated exclusion to prune)`);
      }
    }
  }
  return out;
}

describe("standard-adherence: dist hygiene", () => {
  test("no files field pulls in node_modules (negated exclusions are fine)", () => {
    const violations = distHygieneViolations();
    expect(violations, `dist-hygiene violations:\n${violations.join("\n")}`).toEqual([]);
  });

  test("self-test: the check fires on a node_modules inclusion and stays silent on a negation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standard-dist-self-test-"));
    try {
      const apps = path.join(root, "apps");
      fs.mkdirSync(path.join(apps, "clean"), { recursive: true });
      fs.mkdirSync(path.join(apps, "dirty"), { recursive: true });
      fs.writeFileSync(
        path.join(apps, "clean", "package.json"),
        JSON.stringify({ name: "@hasna/clean", files: ["dist", "!skills/**/node_modules"] }, null, 2),
      );
      fs.writeFileSync(
        path.join(apps, "dirty", "package.json"),
        JSON.stringify({ name: "@hasna/dirty", files: ["dist", "node_modules/foo"] }, null, 2),
      );
      const v = distHygieneViolations(apps);
      expect(v.some((x) => x.startsWith("dirty"))).toBe(true);
      expect(v.some((x) => x.startsWith("clean"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
