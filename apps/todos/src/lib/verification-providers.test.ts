import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { getTaskVerifications } from "../db/task-commits.js";
import { createTask } from "../db/tasks.js";
import { resetConfig } from "./config.js";
import {
  discoverVerificationProviderCapabilities,
  listVerificationProviders,
  removeVerificationProvider,
  runVerificationProvider,
  upsertVerificationProvider,
} from "./verification-providers.js";

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-verification-providers-"));
  process.env["HOME"] = home;
  resetConfig();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  resetConfig();
  rmSync(home, { recursive: true, force: true });
});

describe("local verification provider adapters", () => {
  test("stores provider configs and discovers deterministic capabilities", () => {
    const provider = upsertVerificationProvider({
      name: "unit",
      kind: "command",
      command: "bun test",
      capabilities: ["command", "evidence", "retry"],
      retry: { attempts: 2, backoff_ms: 1 },
    });

    expect(provider.name).toBe("unit");
    expect(listVerificationProviders()).toHaveLength(1);
    expect(discoverVerificationProviderCapabilities("unit")).toMatchObject({
      name: "unit",
      kind: "command",
      capabilities: ["command", "evidence", "retry"],
      configured: true,
      local_only: true,
      network_required: false,
    });
    expect(removeVerificationProvider("unit")).toBe(true);
  });

  test("runs local command providers with retry and redacted task verification evidence", async () => {
    const db = getDatabase();
    const task = createTask({ title: "Verify command" }, db);
    const counter = join(home, "count");
    upsertVerificationProvider({
      name: "flaky",
      kind: "command",
      command: `node -e "const fs=require('fs'); const p='${counter}'; const n=fs.existsSync(p)?Number(fs.readFileSync(p,'utf8')):0; fs.writeFileSync(p, String(n+1)); if(n<1){console.error('TOKEN=supersecret123'); process.exit(1)} console.log('ok {task_id}')"`,
      retry: { attempts: 2, backoff_ms: 1 },
    });

    const result = await runVerificationProvider({ name: "flaky", task_id: task.id, agent_id: "codex" }, db);

    expect(result.status).toBe("passed");
    expect(result.attempts).toBe(2);
    expect(result.output_summary).toContain("ok");
    expect(result.output_summary).not.toContain("supersecret123");
    expect(getTaskVerifications(task.id, db)[0]).toMatchObject({
      command: "provider:flaky",
      status: "passed",
      agent_id: "codex",
    });
  });

  test("imports CI logs and classifies local browser screenshot artifacts", async () => {
    const db = getDatabase();
    const task = createTask({ title: "Verify logs" }, db);
    const artifact = join(home, "screenshot.txt");
    writeFileSync(artifact, "pixel-check-ok");
    upsertVerificationProvider({ name: "ci", kind: "ci_log" });
    upsertVerificationProvider({ name: "browser", kind: "browser" });

    const failed = await runVerificationProvider({
      name: "ci",
      task_id: task.id,
      log_text: "suite failed\n1 fail\nPASSWORD=secretsecret",
    }, db);
    const browser = await runVerificationProvider({
      name: "browser",
      task_id: task.id,
      artifact_path: artifact,
      url: "http://localhost:3000",
    }, db);

    expect(failed.status).toBe("failed");
    expect(failed.output_summary).toContain("[REDACTED]");
    expect(browser.status).toBe("passed");
    expect(browser.artifact_path).toBe(artifact);
  });

  test("blacksmith-style providers are inert until a local command is explicitly configured", async () => {
    upsertVerificationProvider({ name: "testbox", kind: "testbox" });
    expect(discoverVerificationProviderCapabilities("testbox")).toMatchObject({
      configured: false,
      network_required: false,
    });

    const result = await runVerificationProvider({ name: "testbox" });
    expect(result.status).toBe("unknown");
    expect(result.output_summary).toContain("requires an explicit local command");

    upsertVerificationProvider({
      name: "testbox",
      kind: "testbox",
      command: "printf testbox-ok",
    });
    const configured = await runVerificationProvider({ name: "testbox" });
    expect(configured.status).toBe("passed");
    expect(configured.output_summary).toContain("testbox-ok");
  });

  test("times out local command providers deterministically", async () => {
    upsertVerificationProvider({
      name: "slow",
      kind: "command",
      command: "node -e \"setTimeout(() => console.log('late'), 200)\"",
      timeout_ms: 20,
    });

    const result = await runVerificationProvider({ name: "slow" });

    expect(result.status).toBe("failed");
    expect(result.output_summary).toContain("Timed out after 20ms");
  });
});
