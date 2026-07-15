import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempDir = "";

async function runTodos(args: string[]) {
  const child = Bun.spawn({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: join(tempDir, "home"),
      HASNA_EVENTS_DIR: join(tempDir, "events"),
      TODOS_DB_PATH: join(tempDir, "todos.db"),
      HASNA_TODOS_STORAGE_MODE: "local",
      TODOS_STORAGE_MODE: "local",
      HASNA_TODOS_API_URL: "",
      HASNA_TODOS_API_KEY: "",
      TODOS_API_URL: "",
      TODOS_API_KEY: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-events-cli-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("shared events CLI integration", () => {
  test("prints JSON for event and webhook list commands", async () => {
    const events = await runTodos(["events", "list", "--json"]);
    expect(events.exitCode).toBe(0);
    expect(events.stderr).toBe("");
    expect(JSON.parse(events.stdout)).toEqual([]);

    const webhooks = await runTodos(["webhooks", "list", "--json"]);
    expect(webhooks.exitCode).toBe(0);
    expect(webhooks.stderr).toBe("");
    expect(JSON.parse(webhooks.stdout)).toEqual([]);
  });

  test("task.created is delivered to command webhooks", async () => {
    const outputPath = join(tempDir, "captured-events.jsonl");
    const receiverPath = join(tempDir, "receiver.ts");
    writeFileSync(
      receiverPath,
      `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(outputPath)}, process.env.HASNA_EVENT_JSON + "\\n");\n`,
    );

    const addWebhook = await runTodos([
      "webhooks",
      "add",
      "bun",
      "--id",
      "capture-task-created",
      "--transport",
      "command",
      "--type",
      "task.created",
      "--arg",
      receiverPath,
      "--timeout-ms",
      "5000",
      "--json",
    ]);
    expect(addWebhook.exitCode).toBe(0);
    expect(addWebhook.stderr).toBe("");

    const addTask = await runTodos(["add", "Webhook-delivered task", "--json"]);
    expect(addTask.exitCode).toBe(0);

    for (let attempt = 0; attempt < 20 && !existsSync(outputPath); attempt += 1) {
      await Bun.sleep(50);
    }
    expect(existsSync(outputPath)).toBe(true);
    const event = JSON.parse(readFileSync(outputPath, "utf-8").trim().split("\n")[0]!);
    expect(event.source).toBe("todos");
    expect(event.type).toBe("task.created");
    expect(event.data.title).toBe("Webhook-delivered task");
    expect(event.data.working_dir).toBe(process.cwd());
  });

  test("task.created webhook filters honor route opt-in and automation deny metadata", async () => {
    const outputPath = join(tempDir, "captured-route-events.jsonl");
    const receiverPath = join(tempDir, "receiver-route.ts");
    writeFileSync(
      receiverPath,
      `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(outputPath)}, process.env.HASNA_EVENT_JSON + "\\n");\n`,
    );

    const addWebhook = await runTodos([
      "webhooks",
      "add",
      "bun",
      "--id",
      "capture-routable-task-created",
      "--transport",
      "command",
      "--source",
      "todos",
      "--type",
      "task.created",
      "--metadata-json",
      "route_enabled=true",
      "--metadata-json",
      "automation.no_auto!=true",
      "--arg",
      receiverPath,
      "--timeout-ms",
      "5000",
      "--json",
    ]);
    expect(addWebhook.exitCode).toBe(0);
    expect(addWebhook.stderr).toBe("");

    const routable = await runTodos([
      "--json",
      "task",
      "upsert",
      "--fingerprint",
      "route-contract:allowed",
      "--title",
      "Route allowed task",
      "--metadata-json",
      "{\"route_enabled\":true,\"automation\":{\"no_auto\":false}}",
    ]);
    expect(routable.exitCode).toBe(0);

    const noAuto = await runTodos([
      "--json",
      "task",
      "upsert",
      "--fingerprint",
      "route-contract:no-auto",
      "--title",
      "Route denied no-auto task",
      "--metadata-json",
      "{\"route_enabled\":true,\"automation\":{\"no_auto\":true}}",
    ]);
    expect(noAuto.exitCode).toBe(0);

    for (let attempt = 0; attempt < 20 && !existsSync(outputPath); attempt += 1) {
      await Bun.sleep(50);
    }
    expect(existsSync(outputPath)).toBe(true);
    const events = readFileSync(outputPath, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toHaveLength(1);
    expect(events[0].data.title).toBe("Route allowed task");
    expect(events[0].metadata.route_enabled).toBe(true);
    expect(events[0].metadata.automation.no_auto).toBe(false);
  });

  test("task upsert emits task.created once and task.updated on later merges", async () => {
    const outputPath = join(tempDir, "captured-upsert-events.jsonl");
    const receiverPath = join(tempDir, "receiver-upsert.ts");
    writeFileSync(
      receiverPath,
      `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(outputPath)}, process.env.HASNA_EVENT_JSON + "\\n");\n`,
    );

    for (const type of ["task.created", "task.updated"]) {
      const addWebhook = await runTodos([
        "webhooks",
        "add",
        "bun",
        "--id",
        `capture-${type}`,
        "--transport",
        "command",
        "--type",
        type,
        "--arg",
        receiverPath,
        "--timeout-ms",
        "5000",
        "--json",
      ]);
      expect(addWebhook.exitCode).toBe(0);
      expect(addWebhook.stderr).toBe("");
    }

    const first = await runTodos(["--json", "task", "upsert", "--fingerprint", "loop:event:1", "--title", "Event upsert"]);
    expect(first.exitCode).toBe(0);
    const second = await runTodos(["--json", "task", "upsert", "--fingerprint", "loop:event:1", "--title", "Event upsert updated", "--observed", "changed"]);
    expect(second.exitCode).toBe(0);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (existsSync(outputPath) && readFileSync(outputPath, "utf-8").trim().split("\n").filter(Boolean).length >= 2) break;
      await Bun.sleep(50);
    }
    expect(existsSync(outputPath)).toBe(true);
    const events = readFileSync(outputPath, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === "task.created")).toHaveLength(1);
    expect(types.filter((type) => type === "task.updated")).toHaveLength(1);
  });
});
