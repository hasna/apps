/** Child used only by pg-test-gate to exercise the real synchronous server path concurrently. */
import { existsSync, writeFileSync } from "node:fs";
import { markServerContext } from "../../src/storage.js";
import { closeDatabase } from "../../src/db/database.js";
import { registerMachineRecord } from "../../src/db/machines.js";

const hostname = process.env["MEMENTOS_PG_MACHINE_HOSTNAME"];
const name = process.env["MEMENTOS_PG_MACHINE_NAME"];
const readyFile = process.env["MEMENTOS_PG_MACHINE_READY_FILE"];
const barrierFile = process.env["MEMENTOS_PG_MACHINE_BARRIER_FILE"];
if (!hostname || !name || !readyFile || !barrierFile || !process.env["HASNA_MEMENTOS_DATABASE_URL"]) {
  throw new Error("isolated PostgreSQL machine worker configuration is incomplete");
}

writeFileSync(readyFile, "ready", { mode: 0o600 });
const deadline = Date.now() + 10_000;
while (!existsSync(barrierFile)) {
  if (Date.now() >= deadline) throw new Error("machine concurrency barrier timed out");
  await Bun.sleep(10);
}

markServerContext();
try {
  const result = registerMachineRecord({ hostname, name, platform: "linux" });
  process.stdout.write(JSON.stringify({
    id: result.machine.id,
    name: result.machine.name,
    hostname: result.machine.hostname,
    created: result.created,
  }));
} finally {
  closeDatabase();
}
