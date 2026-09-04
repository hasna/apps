import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTmuxProfile, createWorkspace } from "../db/workspaces.js";
import { runMigrations } from "../db/schema.js";
import { HOSTED_API_ENV_KEYS } from "../testing/spawn-env.js";
import { projectTmuxStatus } from "./project-tmux-status.js";
import { PROJECTS_LOCAL_REGISTRY_ENV } from "../store/project-store.js";

// Isolate the shared @hasna/contracts seam's disk tier, mirroring testSpawnEnv():
// when the environment is silent the seam reads fleet app-config files on disk
// (e.g. ~/.hasna/cloud/projects.env) and selects the hosted transport, routing
// these in-process local-store tests at the real hosted registry. An explicitly
// DEFINED-but-blank URL is the seam's own "select the local store" escape hatch
// and beats any disk pointer.
for (const key of HOSTED_API_ENV_KEYS) {
  process.env[key] = "";
}
// Fail closed (owner directive 2026-09-04): with no hosted API env the store
// layer refuses the local registry unless the operator set the explicit opt-in
// HASNA_PROJECTS_LOCAL_REGISTRY=1. These in-process tests drive the local
// registry (blanked above), so pin the opt-in, mirroring testSpawnEnv() and
// project-store.test.ts.
process.env[PROJECTS_LOCAL_REGISTRY_ENV] = "1";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

describe("project tmux status", () => {
  test("reports expected session and windows for a saved profile", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-tmux-status-"));
    createWorkspace({
      name: "Status Project",
      slug: "status-project",
      kind: "project",
      primary_path: path,
    }, db);
    createTmuxProfile({
      name: "Dev",
      slug: "dev",
      session_template: "{slug}-dev",
      windows: [
        {
          window_name_template: "server",
          path_template: "{path}",
          command: "bun run dev",
        },
      ],
    }, db);

    const result = await projectTmuxStatus("status-project", {
      profile: "dev",
      agentTool: "claude",
      db,
    });

    expect(result.project.slug).toBe("status-project");
    expect(result.expected.session_name).toBe("status-project-dev");
    expect(result.expected.profile?.slug).toBe("dev");
    expect(result.expected.windows.map((window) => window.name)).toEqual(["01", "02", "server"]);
    expect(result.expected.windows.map((window) => window.command)).toEqual(["claude --name 'Status Project'", undefined, "bun run dev"]);
    expect(result.rename_report[0]?.status).toBe("configured");
    expect(result.schema_version).toBe(1);
    expect(result.kind).toBe("projects.tmux_status");
    expect(typeof result.exists).toBe("boolean");
    expect(Array.isArray(result.windows)).toBe(true);

    rmSync(path, { recursive: true, force: true });
    db.close();
  });

  test("uses saved launch defaults for expected tmux status", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-tmux-status-defaults-"));
    createWorkspace({
      name: "Default Status",
      slug: "default-status",
      kind: "project",
      primary_path: path,
      metadata: {
        launch_profile: "dev",
        start_agent: "opencode",
        start_command: "opencode run",
        start_session_policy: "error-if-running",
        start_windows: [{ name: "logs", command: "tail -f app.log" }],
      },
    }, db);
    createTmuxProfile({
      name: "Dev",
      slug: "dev",
      session_template: "{slug}-dev",
      windows: [{ window_name_template: "server", command: "bun run dev" }],
    }, db);

    const result = await projectTmuxStatus("default-status", { db });

    expect(result.expected.session_name).toBe("default-status-dev");
    expect(result.expected.profile?.slug).toBe("dev");
    expect(result.launch_defaults.used_agent_tool).toBe(true);
    expect(result.launch_defaults.used_tool_command).toBe(true);
    expect(result.launch_defaults.used_tmux_profile).toBe(true);
    expect(result.launch_defaults.used_session_policy).toBe(true);
    expect(result.launch_defaults.session_policy).toBe("error-if-running");
    expect(result.launch_defaults.used_windows).toBe(true);
    expect(result.expected.windows.map((window) => window.name)).toEqual(["01", "02", "server", "logs"]);
    expect(result.expected.windows.map((window) => window.command)).toEqual(["opencode run", undefined, "bun run dev", "tail -f app.log"]);
    expect(result.rename_report[0]?.status).toBe("unsupported");

    rmSync(path, { recursive: true, force: true });
    db.close();
  });
});
