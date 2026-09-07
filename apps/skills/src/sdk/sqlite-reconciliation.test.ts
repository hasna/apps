import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CreditReservation } from "./governance-store.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// The same assertions can target a real, separately installed public package.
// No production dependency or source file is substituted inside that package.
const selected = process.env["SKILLS_RECONCILIATION_TEST_SDK"];
const governanceUrl = selected ? pathToFileURL(resolve(selected)).href : new URL("./governance-store.ts", import.meta.url).href;
const productUrl = selected ? governanceUrl : new URL("../server/sqlite-store.ts", import.meta.url).href;
const { SqliteGovernanceStore } = await import(governanceUrl) as typeof import("./governance-store.js");
const { SqliteSkillsStore } = await import(productUrl) as typeof import("../server/sqlite-store.js");

// Interpose only on the real database call immediately BEFORE its first
// reservation UPDATE. The old implementation has already read reserved here;
// an atomic implementation has not. Neither SQL nor results are replaced.
// Pausing both children here makes the competing terminal writes deterministic.
const workerSource = String.raw`
import { existsSync, writeFileSync } from "node:fs";
globalThis.fetch = () => { throw new Error("Unexpected fixture network request"); };
const [moduleUrl, dbPath, id, label, status, amount] = process.argv.slice(2);
const { SqliteGovernanceStore } = await import(moduleUrl);
const store = new SqliteGovernanceStore(dbPath, { migrate: false });
const query = store.database.query.bind(store.database);
const run = store.database.run.bind(store.database);
let intercepted = false;
function beforeWrite(sql) {
  if (intercepted || !/^\s*UPDATE\s+skills_credit_reservations\b/i.test(sql)) return;
  intercepted = true;
  const row = query("SELECT status FROM skills_credit_reservations WHERE id = ?").get(id);
  writeFileSync(label + ".ready", JSON.stringify({ pid: process.pid, status: row?.status }));
  const deadline = Date.now() + 10000;
  while (!existsSync(label + ".go")) {
    if (Date.now() > deadline) throw new Error("Reconciliation fixture barrier expired");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
store.database.run = (sql, ...args) => { beforeWrite(sql); return run(sql, ...args); };
store.database.query = (sql, ...args) => {
  const statement = query(sql, ...args);
  return new Proxy(statement, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    return (...params) => { if (["get", "all", "run"].includes(key)) beforeWrite(sql); return value.apply(target, params); };
  }});
};
try {
  const result = await store.reconcileReservation(id, Number(amount), status);
  console.log(JSON.stringify({ result, intercepted }));
} finally { await store.close(); }
`;

type Child = ReturnType<typeof Bun.spawn>;
async function fixture(check: (value: {
  root: string; path: string; store: InstanceType<typeof SqliteSkillsStore>;
  governance: InstanceType<typeof SqliteGovernanceStore>; reservation: CreditReservation;
  untouched: CreditReservation; children: Child[];
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skills-reconciliation-"));
  const path = join(root, "owned.db"), children: Child[] = [];
  const store = new SqliteSkillsStore(path);
  const governance = new SqliteGovernanceStore(path, { migrate: false });
  try {
    const token = "owned-reconciliation-fixture";
    await store.ensureBootstrapApiKey(token, { orgId: "owned-org", orgSlug: "owned-org", orgName: "Owned fixture", userId: "owned-user", email: "owned@example.test" });
    const principal = await store.authenticateApiKeyHash(createHash("sha256").update(token).digest("hex"));
    if (!principal) throw new Error("Fixture bootstrap failed");
    const reservations = [];
    for (const slug of ["owned-target", "owned-untouched"]) {
      const run = await store.createRun({ principal, slug, input: {}, args: [] });
      reservations.push(await governance.createReservation({ orgId: principal.orgId, runId: run.id, estimatedCents: 20 }));
    }
    await mkdir(join(root, "home"));
    await mkdir(join(root, "tmp"));
    await writeFile(join(root, "worker.ts"), workerSource);
    await check({ root, path, store, governance, reservation: reservations[0]!, untouched: reservations[1]!, children });
  } finally {
    // Reap every owned process before closing/removing the database, even when
    // an assertion fails while the second child is waiting at the barrier.
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    await Promise.all(children.map((child) => child.exited));
    await governance.close(); await store.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function ready(root: string, label: string, child: Child): Promise<{ pid: number; status: string }> {
  const path = join(root, label + ".ready"), deadline = Date.now() + 8000;
  while (!existsSync(path)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error("Fixture child did not reach the write barrier");
    await Bun.sleep(10);
  }
  return JSON.parse(await readFile(path, "utf8"));
}

for (const first of ["released", "charged"] as const) {
  test(`SQLite competing processes preserve the first ${first} reconciliation and return it to the loser`, async () => {
    await fixture(async ({ root, path, governance, reservation, untouched, children }) => {
      const statuses = [first, first === "released" ? "charged" : "released"] as const;
      const outputs = statuses.map((status, i) => {
        const label = String(i);
        const child = Bun.spawn([process.execPath, "--no-env-file", join(root, "worker.ts"), governanceUrl, path, reservation.id, label, status, status === "charged" ? "9" : "0"], {
          cwd: root, env: { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PATH: "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
          stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: 20000,
        });
        children.push(child);
        return { child, stdout: new Response(child.stdout).text(), stderr: new Response(child.stderr).text() };
      });
      const atBarrier = await Promise.all(outputs.map(({ child }, i) => ready(root, String(i), child)));
      expect(atBarrier.map((row) => row.status)).toEqual(["reserved", "reserved"]);
      expect(new Set(atBarrier.map((row) => row.pid)).size).toBe(2);
      expect(atBarrier.every((row) => row.pid !== process.pid)).toBe(true);
      expect(await governance.reservationsForRun(reservation.orgId, reservation.runId)).toEqual([reservation]);
      const results = [];
      for (let i = 0; i < outputs.length; i++) {
        await writeFile(join(root, String(i) + ".go"), "go");
        const output = outputs[i]!;
        expect(await output.child.exited).toBe(0);
        expect(await output.stderr).toBe("");
        const result = JSON.parse(await output.stdout) as { result: CreditReservation; intercepted: boolean };
        expect(result.intercepted).toBe(true);
        results.push(result.result);
      }
      const winner = results[0]!;
      expect(winner).toEqual({ ...reservation, status: first, actualCents: first === "charged" ? 9 : 0, reconciledAt: expect.any(String) });
      expect(Number.isFinite(Date.parse(winner.reconciledAt!))).toBe(true);
      expect(results[1]).toEqual(winner);
      expect(await governance.reservationsForRun(reservation.orgId, reservation.runId)).toEqual([winner]);
      expect(await governance.reconcileReservation(reservation.id, 123, "charged")).toEqual(winner);
      expect(await governance.reservationsForRun(untouched.orgId, untouched.runId)).toEqual([untouched]);
      expect(await governance.reconcileReservation("missing-reservation", 5, "charged")).toBeNull();
    });
  });
}

test("SQLite serial retries and failed writes preserve the stored reservation", async () => {
  await fixture(async ({ governance, reservation }) => {
    // A real SQLite failure must leave the row reserved, never fabricate a
    // returned terminal state. Once the constraint is removed, retry succeeds.
    governance.database.exec(`CREATE TRIGGER refuse_fixture_reconcile BEFORE UPDATE ON skills_credit_reservations BEGIN SELECT RAISE(ABORT, 'owned write refusal'); END`);
    await expect(governance.reconcileReservation(reservation.id, 7, "charged")).rejects.toThrow("owned write refusal");
    expect(await governance.reservationsForRun(reservation.orgId, reservation.runId)).toEqual([reservation]);
    governance.database.exec("DROP TRIGGER refuse_fixture_reconcile");
    const winner = await governance.reconcileReservation(reservation.id, 7, "charged");
    expect(winner).not.toBeNull();
    if (!winner) throw new Error("Fixture reservation disappeared");
    expect(winner.status).toBe("charged");
    expect(winner.actualCents).toBe(7);
    expect(await governance.reconcileReservation(reservation.id, 0, "released")).toEqual(winner);
    expect(await governance.reservationsForRun(reservation.orgId, reservation.runId)).toEqual([winner]);
  });
});
