/**
 * publishConfig conformance — standard-adherence suite, check 2.
 *
 * Every publishable member must declare publishConfig.access === "public"
 * (repo law: every member is a PUBLIC @hasna/* package) and nothing may be
 * private:true except recorded non-publishable members.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APPS_DIR, membersIn, PUBLISH_CONFIG_EXCEPTIONS, PRIVATE_TRUE_EXCEPTIONS, NON_PUBLISHABLE } from "./census";

export function publishConfigViolations(appsDir: string = APPS_DIR): string[] {
  const out: string[] = [];
  const ms = membersIn(appsDir);
  for (const m of ms) {
    if (!m.publishable && !PRIVATE_TRUE_EXCEPTIONS.includes(m.name)) {
      out.push(`${m.name}: private:true without a recorded exception`);
    }
  }
  for (const m of ms.filter((x) => x.publishable)) {
    if (m.access !== "public" && !PUBLISH_CONFIG_EXCEPTIONS.includes(m.name)) {
      out.push(`${m.name}: publishConfig.access=${String(m.access)} (expected "public")`);
    }
  }
  for (const n of NON_PUBLISHABLE) {
    if (!ms.some((m) => m.name === n)) out.push(`recorded non-publishable member ${n} no longer exists`);
  }
  for (const n of PRIVATE_TRUE_EXCEPTIONS) {
    const m = ms.find((x) => x.name === n);
    if (!m || !m.private) out.push(`recorded private:true exception ${n} is no longer private:true — remove the entry`);
  }
  for (const n of PUBLISH_CONFIG_EXCEPTIONS) {
    const m = ms.find((x) => x.name === n);
    if (!m || m.access === "public") out.push(`recorded publishConfig exception ${n} is now public — remove the entry`);
  }
  return out;
}

describe("standard-adherence: publishConfig", () => {
  test("every publishable member declares publishConfig.access === 'public'", () => {
    const violations = publishConfigViolations();
    expect(violations, `publishConfig violations:\n${violations.join("\n")}`).toEqual([]);
  });

  test("self-test: the check fires on a private or unpublic member and stays silent on a clean one", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standard-publish-self-test-"));
    try {
      const apps = path.join(root, "apps");
      fs.mkdirSync(path.join(apps, "clean"), { recursive: true });
      fs.mkdirSync(path.join(apps, "no-access"), { recursive: true });
      fs.mkdirSync(path.join(apps, "private-true"), { recursive: true });
      fs.writeFileSync(path.join(apps, "clean", "package.json"), JSON.stringify({ name: "@hasna/x", publishConfig: { access: "public" } }, null, 2));
      fs.writeFileSync(path.join(apps, "no-access", "package.json"), JSON.stringify({ name: "@hasna/y" }, null, 2));
      fs.writeFileSync(path.join(apps, "private-true", "package.json"), JSON.stringify({ name: "@hasna/z", private: true }, null, 2));
      const violations = publishConfigViolations(apps);
      expect(violations.some((v) => v.startsWith("no-access"))).toBe(true);
      expect(violations.some((v) => v.startsWith("private-true"))).toBe(true);
      expect(violations.some((v) => v.startsWith("clean"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
