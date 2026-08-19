import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { JsonActionsStore } from "./storage.js";

const storageModule = join(import.meta.dir, "storage.ts");

/**
 * Appends disjoint audit events from two independent Bun child processes against the
 * same temporary JSON store directory. The JSON store's read-modify-write cycles must
 * not lose either writer's records, or the audit trail is incomplete.
 */
const concurrentWriterScript = `
import { JsonActionsStore } from ${JSON.stringify(storageModule)};

const [, , dataDir, tag, count] = process.argv;
const store = new JsonActionsStore(dataDir);
for (let index = 0; index < Number(count); index += 1) {
  await store.appendAuditEvent({
    id: \`\${tag}-\${index}\`,
    runId: "run-shared",
    actionId: "test.action",
    type: "action.planned",
    time: new Date().toISOString(),
    severity: "info",
    message: "planned",
    data: {},
    metadata: {},
  });
}
console.log("WRITER OK");
`;

describe("JsonActionsStore concurrent writers", () => {
  test("two child processes writing disjoint records both survive after reopening", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-concurrent-"));
    const dir = join(root, "actions");
    try {
      const scriptPath = join(root, "writer.ts");
      writeFileSync(scriptPath, concurrentWriterScript);
      const eventsPerWriter = 10;

      const writers = ["writer-a", "writer-b"].map((tag) =>
        Bun.spawn([
          process.execPath,
          scriptPath,
          dir,
          tag,
          String(eventsPerWriter),
        ], { stdout: "pipe", stderr: "pipe" }),
      );

      const results = await Promise.all(writers.map(async (child) => {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { stdout, stderr, exitCode };
      }));

      for (const result of results) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("WRITER OK");
      }

      const store = new JsonActionsStore(dir);
      const events = await store.listAuditEvents();
      expect(events).toHaveLength(eventsPerWriter * 2);
      const ids = new Set(events.map((event) => event.id));
      for (let index = 0; index < eventsPerWriter; index += 1) {
        expect(ids.has(`writer-a-${index}`)).toBe(true);
        expect(ids.has(`writer-b-${index}`)).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
