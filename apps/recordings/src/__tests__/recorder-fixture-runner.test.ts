import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function ownedRoot() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "recordings-recorder-report-")));
  chmodSync(root, 0o700); roots.push(root); return root;
}
function run(destination: string) {
  return Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../../scripts/test-recorder-fixtures.ts"), "--junit-output", destination], {
    env: { PATH: "/usr/bin:/bin", HOME: dirnameForHome(destination), TMPDIR: realpathSync(tmpdir()) },
    stdout: "pipe", stderr: "pipe", timeout: 35000,
  });
}
function dirnameForHome(path: string) { return resolve(path, ".."); }
test("recorder runner exports complete test inventory through a private new JUnit file", () => {
  const root = ownedRoot(), report = join(root, "recorder.xml");
  const result = run(report);
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const xml = readFileSync(report, "utf8");
  expect((xml.match(/<testcase\b/g) ?? []).length).toBe(16);
  expect(xml).not.toContain("<failure");
  expect(xml).not.toContain("<skipped");
  expect(lstatSync(report).mode & 0o777).toBe(0o600);
}, 40000);
test("recorder runner refuses existing files and symlinks without overwriting", () => {
  const root = ownedRoot(), existing = join(root, "existing.xml"), link = join(root, "link.xml");
  writeFileSync(existing, "preserve"); symlinkSync(existing, link);
  for (const destination of [existing, link]) {
    const result = run(destination);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("new path");
  }
  expect(readFileSync(existing, "utf8")).toBe("preserve");
});
test("recorder runner refuses symlinked or nonprivate report parents", () => {
  const root = ownedRoot(), alias = join(root, "alias");
  symlinkSync(root, alias);
  expect(run(join(alias, "report.xml")).exitCode).not.toBe(0);
  chmodSync(root, 0o755);
  expect(run(join(root, "report.xml")).exitCode).not.toBe(0);
  expect(existsSync(join(root, "report.xml"))).toBeFalse();
});
