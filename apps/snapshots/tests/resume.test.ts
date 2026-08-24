import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  claudeProjectSlug,
  createResumeIdentityResolver,
  defaultClaudeProjectsDir,
  defaultOpenCodeDbPath
} from "../src/capture/resume.js";

function fixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), "snapshots-resume-"));
}

interface SessionV2Row {
  id: string;
  projectId: string;
  slug: string;
  directory: string;
  version: string;
  title?: string | null;
  agent?: string | null;
  model?: string | null;
  timeCreated: number;
  timeUpdated: number;
}

function createOpenCodeDb(path: string, rows: SessionV2Row[]): void {
  const db = new Database(path, { create: true });
  db.exec(`
    CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      version TEXT NOT NULL,
      title TEXT,
      agent TEXT,
      model TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
  `);
  const insert = db.query(
    `INSERT INTO session_v2 (id, project_id, slug, directory, version, title, agent, model, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of rows) {
    insert.run(row.id, row.projectId, row.slug, row.directory, row.version, row.title ?? null, row.agent ?? null, row.model ?? null, row.timeCreated, row.timeUpdated);
  }
  db.close();
}

function writeClaudeJsonl(dir: string, name: string, cwd: string, sessionId: string, mtimeMs: number): void {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify({ type: "user", cwd, sessionId, timestamp: new Date(mtimeMs).toISOString() })}\n`);
  utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
}

describe("claudeProjectSlug", () => {
  test("mirrors Claude Code's lossy project folder naming", () => {
    expect(claudeProjectSlug("/home/hasna/.hasna/projects/workspaces/wks_xMeijBDhYFBzxXtPlttyw")).toBe(
      "-home-hasna--hasna-projects-workspaces-wks-xMeijBDhYFBzxXtPlttyw"
    );
    expect(claudeProjectSlug("/home/hasna")).toBe("-home-hasna");
    expect(claudeProjectSlug("/tmp/a_b")).toBe("-tmp-a-b");
  });

  test("different cwds can collide under one slug (the lossy case)", () => {
    expect(claudeProjectSlug("/tmp/a_b")).toBe(claudeProjectSlug("/tmp/a-b"));
  });
});

describe("opencode2 resume identity", () => {
  test("resolves the latest session_v2 row for the pane cwd", () => {
    const root = fixtureRoot();
    const dbPath = join(root, "opencode.db");
    const cwd = "/tmp/pane-cwd";
    createOpenCodeDb(dbPath, [
      {
        id: "ses_older",
        projectId: "p1",
        slug: "s1",
        directory: cwd,
        version: "v",
        title: "older session",
        agent: "build",
        model: "{\"id\":\"deepseek-v4-flash\",\"providerID\":\"opencode-go\",\"variant\":\"max\"}",
        timeCreated: 1_787_000_000_000,
        timeUpdated: 1_787_500_000_000
      },
      {
        id: "ses_newest",
        projectId: "p1",
        slug: "s1",
        directory: cwd,
        version: "v",
        title: "newest session",
        agent: "general",
        model: "{\"id\":\"gpt-5.6-sol\",\"providerID\":\"openai\",\"variant\":\"xhigh\"}",
        timeCreated: 1_787_550_000_000,
        timeUpdated: 1_787_556_333_337
      }
    ]);
    const resolver = createResumeIdentityResolver({
      opencodeDbPath: dbPath,
      claudeProjectsDir: join(root, "absent-claude")
    });

    const identity = resolver.resolve(cwd);

    expect(identity.opencode2).toMatchObject({
      session_id: "ses_newest",
      title: "newest session",
      directory: cwd,
      model_id: "gpt-5.6-sol",
      agent: "general",
      time_updated_ms: 1_787_556_333_337
    });
    resolver.close();
  });

  test("returns null when no session directory matches", () => {
    const root = fixtureRoot();
    const dbPath = join(root, "opencode.db");
    createOpenCodeDb(dbPath, [
      {
        id: "ses_elsewhere",
        projectId: "p1",
        slug: "s1",
        directory: "/other/dir",
        version: "v",
        timeCreated: 1,
        timeUpdated: 2
      }
    ]);
    const resolver = createResumeIdentityResolver({
      opencodeDbPath: dbPath,
      claudeProjectsDir: join(root, "absent-claude")
    });

    expect(resolver.resolve("/tmp/pane-cwd").opencode2).toBeNull();
    resolver.close();
  });

  test("never creates or mutates a missing opencode database", () => {
    const root = fixtureRoot();
    const dbPath = join(root, "opencode.db");
    const resolver = createResumeIdentityResolver({
      opencodeDbPath: dbPath,
      claudeProjectsDir: join(root, "absent-claude")
    });

    expect(resolver.resolve("/tmp/pane-cwd").opencode2).toBeNull();
    expect(existsSync(dbPath)).toBe(false);
    expect(resolver.diagnostics.some((d) => d.source === "resume-identity" && d.message.includes("opencode2"))).toBe(true);
    resolver.close();
  });

  test("memoizes identity per cwd and dedupes diagnostics", () => {
    const root = fixtureRoot();
    const dbPath = join(root, "opencode.db");
    createOpenCodeDb(dbPath, [
      {
        id: "ses_one",
        projectId: "p1",
        slug: "s1",
        directory: "/tmp/pane-cwd",
        version: "v",
        timeCreated: 1,
        timeUpdated: 2
      }
    ]);
    const resolver = createResumeIdentityResolver({
      opencodeDbPath: dbPath,
      claudeProjectsDir: join(root, "absent-claude")
    });

    const first = resolver.resolve("/tmp/pane-cwd");
    const second = resolver.resolve("/tmp/pane-cwd/");
    expect(first.opencode2?.session_id).toBe("ses_one");
    expect(second).toBe(first);
    expect(resolver.diagnostics.filter((d) => d.message.includes("Claude"))).toHaveLength(1);
    resolver.close();
  });
});

describe("claude resume identity", () => {
  test("picks the newest JSONL whose recorded cwd matches the pane cwd", () => {
    const root = fixtureRoot();
    const cwd = "/home/hasna/projects/alpha";
    const projectsDir = join(root, "claude-projects");
    const slugDir = join(projectsDir, claudeProjectSlug(cwd));
    mkdirSync(slugDir, { recursive: true });
    writeClaudeJsonl(slugDir, "older.jsonl", cwd, "older-session", 1_787_000_000_000);
    writeClaudeJsonl(slugDir, "newer-wrong-cwd.jsonl", "/somewhere/else", "wrong-session", 1_787_500_000_000);
    writeClaudeJsonl(slugDir, "newest.jsonl", cwd, "newest-session", 1_787_600_000_000);
    const resolver = createResumeIdentityResolver({
      opencodeDbPath: join(root, "absent.db"),
      claudeProjectsDir: projectsDir
    });

    const identity = resolver.resolve(cwd);

    expect(identity.claude).toMatchObject({
      session_id: "newest-session",
      cwd,
      file: "newest.jsonl"
    });
    expect(identity.claude?.modified_at).toBe(new Date(1_787_600_000_000).toISOString());
    resolver.close();
  });

  test("matches on the recorded cwd inside the file, not the lossy slug", () => {
    const root = fixtureRoot();
    const cwdA = "/tmp/a_b";
    const cwdB = "/tmp/a-b";
    expect(claudeProjectSlug(cwdA)).toBe(claudeProjectSlug(cwdB));
    const projectsDir = join(root, "claude-projects");
    const slugDir = join(projectsDir, claudeProjectSlug(cwdA));
    mkdirSync(slugDir, { recursive: true });
    // Only cwdB ever ran in this slug dir. Resolving cwdA must NOT claim it.
    writeClaudeJsonl(slugDir, "b-only.jsonl", cwdB, "b-session", 1_787_600_000_000);
    const resolver = createResumeIdentityResolver({
      opencodeDbPath: join(root, "absent.db"),
      claudeProjectsDir: projectsDir
    });

    expect(resolver.resolve(cwdA).claude).toBeNull();
    expect(resolver.resolve(cwdB).claude?.session_id).toBe("b-session");
    resolver.close();
  });

  test("returns null when no JSONL records the pane cwd", () => {
    const root = fixtureRoot();
    const projectsDir = join(root, "claude-projects");
    const slugDir = join(projectsDir, claudeProjectSlug("/tmp/pane-cwd"));
    mkdirSync(slugDir, { recursive: true });
    writeClaudeJsonl(slugDir, "elsewhere.jsonl", "/other/cwd", "other-session", 1_787_600_000_000);
    const resolver = createResumeIdentityResolver({
      opencodeDbPath: join(root, "absent.db"),
      claudeProjectsDir: projectsDir
    });

    expect(resolver.resolve("/tmp/pane-cwd").claude).toBeNull();
    resolver.close();
  });

  test("emits a single info diagnostic when the claude projects dir is absent", () => {
    const root = fixtureRoot();
    const resolver = createResumeIdentityResolver({
      opencodeDbPath: join(root, "absent.db"),
      claudeProjectsDir: join(root, "no-claude-dir")
    });

    resolver.resolve("/tmp/pane-cwd");
    resolver.resolve("/tmp/other-cwd");

    expect(resolver.diagnostics.filter((d) => d.message.includes("Claude"))).toHaveLength(1);
    resolver.close();
  });
});

describe("resume identity defaults", () => {
  test("defaults point at the opencode2 and claude data locations", () => {
    expect(defaultOpenCodeDbPath()).toContain(".local/share/opencode/opencode.db");
    expect(defaultClaudeProjectsDir()).toContain(".claude/projects");
  });
});
