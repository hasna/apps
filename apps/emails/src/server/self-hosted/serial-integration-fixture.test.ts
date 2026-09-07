import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createSerialIntegrationFixture, MIGRATION_CASE_TIMEOUT_MS, MIGRATION_DRAIN_TIMEOUT_MS } from "../../../scripts/serial-integration-fixture.js";

test("migration fixture has finite scoped deadlines and preserves callback rejection", async () => {
  expect(MIGRATION_CASE_TIMEOUT_MS).toBe(30_000);
  expect(MIGRATION_DRAIN_TIMEOUT_MS).toBe(10_000);
  const fixture = createSerialIntegrationFixture();
  const error = new Error("owned failure");
  await expect(fixture.run(async () => { throw error; })).rejects.toBe(error);
  await fixture.drain();
  let ran = false;
  await fixture.run(async () => { ran = true; });
  expect(ran).toBe(true);
  for (const invalid of [0, -1, Infinity, NaN]) expect(() => createSerialIntegrationFixture(invalid)).toThrow();
});

test.each(["timeout-drain", "late-rejection", "drain-expiry"] as const)("real Bun %s cannot overlap fixture callbacks", async (mode) => {
  const root = await mkdtemp(join(tmpdir(), "emails-serial-fixture-"));
  const home = join(root, "home"), events = join(root, "events.jsonl");
  await mkdir(home);
  const helper = resolve(import.meta.dir, "../../../scripts/serial-integration-fixture.ts");
  const source = `import { afterAll, afterEach, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { createSerialIntegrationFixture } from ${JSON.stringify(helper)};
const mode = ${JSON.stringify(mode)}, record = (value) => appendFileSync(${JSON.stringify(events)}, JSON.stringify(value) + "\\n");
const fixture = createSerialIntegrationFixture(mode === "drain-expiry" ? 25 : 1000);
afterEach(() => fixture.drain(), 1500);
test("owned slow callback", () => fixture.run(async () => {
  record("started"); await Bun.sleep(200); record("settled");
  if (mode === "late-rejection") throw new Error("owned late rejection");
}), 25);
test("next owned reset", () => fixture.run(async () => { record("next-reset"); }), 1000);
afterAll(async () => {
  await Bun.sleep(250);
  if (mode === "drain-expiry") {
    expect(() => fixture.run(async () => { record("poisoned-reset"); })).toThrow("refusing another schema reset");
    record("poison-retained-after-settlement");
  }
}, 1500);
`;
  try {
    const file = join(root, "owned.test.ts");
    await writeFile(file, source);
    const result = await new Promise<{ status: number | null; output: string }>((accept, reject) => {
      const child = spawn(process.execPath, ["--no-env-file", "--no-install", "test", file], {
        cwd: root, env: { HOME: home, USERPROFILE: home, PATH: "/usr/bin:/bin", TMPDIR: root, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "", expired = false;
      const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 4000);
      child.stdout.on("data", chunk => { output += chunk; });
      child.stderr.on("data", chunk => { output += chunk; });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", status => { clearTimeout(timer); expired ? reject(new Error("Owned Bun fixture exceeded process deadline")) : accept({ status, output }); });
    });
    expect(result.status).toBe(1); // The deliberately timed-out test must still fail.
    expect(result.output).toContain("this test timed out after 25ms");
    // Bun still reports a timed-out callback's late rejection. Preserve that
    // failure visibly; the safety requirement is waiting before another reset.
    if (mode === "late-rejection") expect(result.output).toContain("error: owned late rejection");
    else expect(result.output).not.toContain("Unhandled error between tests");
    const markers = (await readFile(events, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    if (mode === "drain-expiry") {
      expect(result.output).toContain("Integration callback exceeded the drain deadline");
      expect(markers).toEqual(["started", "settled", "poison-retained-after-settlement"]);
    } else {
      expect(result.output).toContain("(pass) next owned reset");
      expect(markers).toEqual(["started", "settled", "next-reset"]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 5000);
