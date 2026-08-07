import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../db/database.js";
import { runMigrations } from "../db/schema.js";
import { createWorkspace } from "../db/workspaces.js";
import { __resetProjectStore } from "../store/project-store.js";
import {
  isLoopbackReportsHost,
  listProjectsWithReports,
  serveProjectReports,
} from "./project-reports-server.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

function makeReportsProject(
  db: Database,
  root: string,
  input: {
    id: string;
    slug: string;
    name: string;
    reports: Record<string, Record<string, string>>;
  },
) {
  const projectPath = join(root, input.slug);
  for (const [date, files] of Object.entries(input.reports)) {
    const datePath = join(projectPath, "reports", date);
    mkdirSync(datePath, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(datePath, name), body);
    }
  }
  return createWorkspace({
    id: input.id,
    name: input.name,
    slug: input.slug,
    kind: "project",
    primary_path: projectPath,
  }, db);
}

describe("project reports server", () => {
  test("lists registered projects with dated reports without leaking local paths", async () => {
    const root = join(tmpdir(), `projects-reports-list-${randomUUID()}`);
    const db = makeDb();
    try {
      makeReportsProject(db, root, {
        id: "wks_reports_alpha",
        slug: "alpha",
        name: "Alpha Project",
        reports: {
          "2026-07-03": { "daily.md": "# Alpha daily" },
          "2026-07-04": { "index.html": "<h1>Alpha</h1>" },
        },
      });
      makeReportsProject(db, root, {
        id: "wks_reports_beta",
        slug: "beta",
        name: "Beta Project",
        reports: {
          "2026-07-04": { "summary.md": "# Beta summary" },
        },
      });
      createWorkspace({
        id: "wks_reports_empty",
        name: "Empty Project",
        slug: "empty",
        kind: "project",
        primary_path: join(root, "empty"),
      }, db);

      const indexed = await listProjectsWithReports({ db });
      expect(indexed.map((item) => item.project.slug)).toEqual(["alpha", "beta"]);
      expect(indexed[0]?.latestDate).toBe("2026-07-04");
      expect(indexed[0]?.reportCount).toBe(2);

      const served = await serveProjectReports({ db, host: "127.0.0.1", port: 0 });
      try {
        const rootPage = await fetch(`http://127.0.0.1:${served.port}/`);
        expect(rootPage.status).toBe(200);
        const rootHtml = await rootPage.text();
        expect(rootHtml).toContain("Alpha Project");
        expect(rootHtml).toContain("Beta Project");
        expect(rootHtml).not.toContain(root);
        expect(rootHtml).not.toContain("Empty Project");

        const projectPage = await fetch(`http://127.0.0.1:${served.port}/alpha`);
        expect(projectPage.status).toBe(200);
        const projectHtml = await projectPage.text();
        expect(projectHtml).toContain("2026-07-04");
        expect(projectHtml).toContain("index.html");
        expect(projectHtml).toContain("daily.md");
      } finally {
        served.server.stop(true);
      }
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("renders markdown with dark mode typography, code blocks, and escaped HTML", async () => {
    const root = join(tmpdir(), `projects-reports-markdown-${randomUUID()}`);
    const db = makeDb();
    try {
      makeReportsProject(db, root, {
        id: "wks_reports_markdown",
        slug: "markdown",
        name: "Markdown Reports",
        reports: {
          "2026-07-04": {
            "daily.md": [
              "# Daily Report",
              "",
              "A paragraph with **strong** text and `inline()` code.",
              "",
              "```ts",
              "const answer = 42;",
              "```",
              "",
              "<script>alert('x')</script>",
            ].join("\n"),
          },
        },
      });
      const served = await serveProjectReports({ db, host: "127.0.0.1", port: 0 });
      try {
        const response = await fetch(`http://127.0.0.1:${served.port}/markdown/2026-07-04/daily.md`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        const html = await response.text();
        expect(html).toContain("markdown-body");
        expect(html).toContain("prefers-color-scheme: dark");
        expect(html).toContain("<h1>Daily Report</h1>");
        expect(html).toContain("<strong>strong</strong>");
        expect(html).toContain("<code>inline()</code>");
        expect(html).toContain('<pre><code class="language-ts">const answer = 42;</code></pre>');
        expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
        expect(html).not.toContain("<script>alert");
      } finally {
        served.server.stop(true);
      }
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("serves raw HTML as-is with a CSP sandbox", async () => {
    const root = join(tmpdir(), `projects-reports-html-${randomUUID()}`);
    const db = makeDb();
    try {
      makeReportsProject(db, root, {
        id: "wks_reports_html",
        slug: "html",
        name: "HTML Reports",
        reports: {
          "2026-07-04": {
            "report.html": "<!doctype html><h1>Raw HTML</h1><script>window.ran = true</script>",
          },
        },
      });
      const served = await serveProjectReports({ db, host: "127.0.0.1", port: 0 });
      try {
        const response = await fetch(`http://127.0.0.1:${served.port}/html/2026-07-04/report.html`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        const csp = response.headers.get("content-security-policy") ?? "";
        expect(csp).toContain("sandbox");
        expect(csp).toContain("script-src 'none'");
        expect(await response.text()).toBe("<!doctype html><h1>Raw HTML</h1><script>window.ran = true</script>");
      } finally {
        served.server.stop(true);
      }
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects traversal and non-report paths", async () => {
    const root = join(tmpdir(), `projects-reports-traversal-${randomUUID()}`);
    const db = makeDb();
    try {
      makeReportsProject(db, root, {
        id: "wks_reports_safe",
        slug: "safe",
        name: "Safe Reports",
        reports: {
          "2026-07-04": {
            "daily.md": "# Safe",
            "notes.txt": "not a report",
          },
        },
      });
      const served = await serveProjectReports({ db, host: "127.0.0.1", port: 0 });
      try {
        const traversal = await fetch(`http://127.0.0.1:${served.port}/safe/2026-07-04/%2e%2e%2Fsecret.md`);
        expect(traversal.status).toBe(400);
        expect(await traversal.text()).toContain("invalid report path");

        const unsupported = await fetch(`http://127.0.0.1:${served.port}/safe/2026-07-04/notes.txt`);
        expect(unsupported.status).toBe(404);
        expect(await unsupported.text()).toContain("unsupported report type");

        const extraSegment = await fetch(`http://127.0.0.1:${served.port}/safe/2026-07-04/daily.md/extra`);
        expect(extraSegment.status).toBe(404);
      } finally {
        served.server.stop(true);
      }
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a symlinked reports root that escapes the project directory", async () => {
    const root = join(tmpdir(), `projects-reports-symlink-${randomUUID()}`);
    const db = makeDb();
    try {
      const projectPath = join(root, "symlinked");
      const outsideReports = join(root, "outside-reports");
      mkdirSync(join(outsideReports, "2026-07-04"), { recursive: true });
      mkdirSync(projectPath, { recursive: true });
      writeFileSync(join(outsideReports, "2026-07-04", "outside.md"), "# Outside");
      symlinkSync(outsideReports, join(projectPath, "reports"), "dir");
      createWorkspace({
        id: "wks_reports_symlink",
        name: "Symlink Reports",
        slug: "symlinked",
        kind: "project",
        primary_path: projectPath,
      }, db);

      expect((await listProjectsWithReports({ db })).map((item) => item.project.slug)).not.toContain("symlinked");

      const served = await serveProjectReports({ db, host: "127.0.0.1", port: 0 });
      try {
        const response = await fetch(`http://127.0.0.1:${served.port}/symlinked/2026-07-04/outside.md`);
        expect(response.status).toBe(404);
      } finally {
        served.server.stop(true);
      }
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("defaults to loopback and rejects non-loopback without token or trust", async () => {
    expect(isLoopbackReportsHost("127.0.0.1")).toBe(true);
    expect(isLoopbackReportsHost("0.0.0.0")).toBe(false);

    const db = makeDb();
    const defaultServer = await serveProjectReports({ db, port: 0 });
    try {
      expect(defaultServer.host).toBe("127.0.0.1");
      expect(defaultServer.url).toBe(`http://127.0.0.1:${defaultServer.port}/`);
      const health = await fetch(`http://127.0.0.1:${defaultServer.port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true, mode: "reports" });
    } finally {
      defaultServer.server.stop(true);
      db.close();
    }

    await expect(
      serveProjectReports({ host: "0.0.0.0", port: 0 }),
    ).rejects.toThrow("PROJECTS_REPORTS_TOKEN");

    // These servers serve pages, so they are given an explicit db: without one
    // the server resolves the machine's configured registry (correctly — that
    // is the point of the transport fix) and this host-binding test would
    // depend on the network.
    const bindingDb = makeDb();
    try {
      const configured = await serveProjectReports({ db: bindingDb, host: "127.0.0.1", port: 0 });
      try {
        expect(configured.host).toBe("127.0.0.1");
        expect(configured.url).toBe(`http://127.0.0.1:${configured.port}/`);
      } finally {
        configured.server.stop(true);
      }

      const trusted = await serveProjectReports({ db: bindingDb, host: "0.0.0.0", port: 0, trustNetwork: true });
      try {
        expect(trusted.host).toBe("0.0.0.0");
        const response = await fetch(`http://127.0.0.1:${trusted.port}/`);
        expect(response.status).toBe(200);
        expect(response.headers.get("set-cookie")).toBeNull();
      } finally {
        trusted.server.stop(true);
      }
    } finally {
      bindingDb.close();
    }
  });

  test("non-loopback token mode gates reports without accepting URL tokens", async () => {
    const root = join(tmpdir(), `projects-reports-token-${randomUUID()}`);
    const db = makeDb();
    try {
      makeReportsProject(db, root, {
        id: "wks_reports_token",
        slug: "token-reports",
        name: "Token Reports",
        reports: {
          "2026-07-04": { "daily.md": "# Token daily" },
        },
      });

      const served = await serveProjectReports({
        db,
        host: "0.0.0.0",
        port: 0,
        token: "test-reports-token",
      });
      try {
        const denied = await fetch(`http://127.0.0.1:${served.port}/`);
        expect(denied.status).toBe(401);
        expect(await denied.text()).toContain("Reports access token");

        const queryToken = await fetch(`http://127.0.0.1:${served.port}/?token=test-reports-token`);
        expect(queryToken.status).toBe(401);
        expect(await queryToken.text()).not.toContain("test-reports-token");

        const invalidSession = await fetch(
          `http://127.0.0.1:${served.port}/session?returnTo=${encodeURIComponent("/token-reports")}`,
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: "wrong-token" }),
          },
        );
        expect(invalidSession.status).toBe(401);
        const invalidSessionHtml = await invalidSession.text();
        expect(invalidSessionHtml).toContain("returnTo=%2Ftoken-reports");
        expect(invalidSessionHtml).not.toContain("returnTo=%2Fsession");

        const authorized = await fetch(`http://127.0.0.1:${served.port}/`, {
          headers: { authorization: "Bearer test-reports-token" },
        });
        expect(authorized.status).toBe(200);
        expect(await authorized.text()).toContain("Token Reports");

        const session = await fetch(`http://127.0.0.1:${served.port}/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "test-reports-token" }),
        });
        expect(session.status).toBe(200);
        expect(session.headers.get("set-cookie")).toContain("projects_reports=");

        const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
        const withCookie = await fetch(`http://127.0.0.1:${served.port}/token-reports`, {
          headers: { cookie },
        });
        expect(withCookie.status).toBe(200);
        expect(await withCookie.text()).toContain("daily.md");
      } finally {
        served.server.stop(true);
      }
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// --------------------------------------------------------------------------
// Registry transport
//
// The reports server lists REGISTERED PROJECTS, which is registry truth rather
// than machine-local runtime state. It must therefore read whichever registry
// the environment selects, exactly like every other registry surface.
//
// Regression: the server read `db/workspaces.ts` directly, bypassing the
// `resolveProjectStore()` seam. On a box configured for the hosted API that
// silently served a frozen on-box sqlite snapshot instead — every project
// created after the file went stale 404s, and the failure is indistinguishable
// from the project not existing.
// --------------------------------------------------------------------------

const REGISTRY_ENV_KEYS = [
  "HASNA_PROJECTS_API_URL",
  "HASNA_PROJECTS_API_KEY",
  "HASNA_PROJECTS_STORAGE_MODE",
  "HASNA_PROJECTS_MODE",
  "PROJECTS_API_URL",
  "PROJECTS_API_KEY",
  "PROJECTS_STORAGE_MODE",
  "PROJECTS_MODE",
  "HASNA_PROJECTS_DB_PATH",
  "HASNA_WORKSPACES_DB_PATH",
] as const;

function captureRegistryEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of REGISTRY_ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreRegistryEnv(saved: Record<string, string | undefined>): void {
  for (const key of REGISTRY_ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Write a project's report files to disk and return its primary_path. */
function writeReportFiles(
  root: string,
  slug: string,
  reports: Record<string, Record<string, string>>,
): string {
  const projectPath = join(root, slug);
  for (const [date, files] of Object.entries(reports)) {
    const datePath = join(projectPath, "reports", date);
    mkdirSync(datePath, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(datePath, name), body);
    }
  }
  return projectPath;
}

describe("project reports server registry transport", () => {
  test("serves the configured registry, never a stale on-box sqlite snapshot", async () => {
    const root = join(tmpdir(), `projects-reports-transport-${randomUUID()}`);
    const savedEnv = captureRegistryEnv();
    const realFetch = globalThis.fetch;
    const stalePath = writeReportFiles(root, "stale-alpha", {
      "2026-07-04": { "daily.md": "# stale alpha" },
    });
    const livePath = writeReportFiles(root, "live-beta", {
      "2026-07-05": { "daily.md": "# live beta" },
    });

    // The on-box file every un-migrated caller reads. It holds ONLY the stale
    // project, so reading it is observable rather than inferred.
    const staleDbPath = join(root, "stale-registry.db");
    const staleDb = new Database(staleDbPath);
    staleDb.run("PRAGMA foreign_keys=ON");
    runMigrations(staleDb);
    createWorkspace({
      id: "wks_stale_alpha",
      name: "Stale Alpha",
      slug: "stale-alpha",
      kind: "project",
      primary_path: stalePath,
    }, staleDb);
    staleDb.close();

    let registryRequests = 0;
    try {
      process.env["HASNA_PROJECTS_DB_PATH"] = staleDbPath;
      process.env["HASNA_PROJECTS_API_URL"] = "https://projects.test.invalid";
      process.env["HASNA_PROJECTS_API_KEY"] = "test-registry-key";
      delete process.env["HASNA_WORKSPACES_DB_PATH"];
      delete process.env["HASNA_PROJECTS_STORAGE_MODE"];
      delete process.env["HASNA_PROJECTS_MODE"];

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!href.startsWith("https://projects.test.invalid")) {
          return realFetch(input as Parameters<typeof realFetch>[0], init);
        }
        registryRequests += 1;
        const offset = Number(new URL(href).searchParams.get("offset") ?? "0");
        const workspaces = offset === 0
          ? [{
            id: "wks_live_beta",
            name: "Live Beta",
            slug: "live-beta",
            kind: "project",
            status: "active",
            primary_path: livePath,
          }]
          : [];
        return new Response(JSON.stringify({
          workspaces,
          count: workspaces.length,
          total: 1,
          offset,
          limit: 1000,
          has_more: offset + workspaces.length < 1,
          complete: offset === 0 && workspaces.length === 1,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof globalThis.fetch;

      closeDatabase();
      __resetProjectStore();

      const indexed = await listProjectsWithReports();
      const slugs = indexed.map((item) => item.project.slug);

      // The configured registry is the one that answers.
      expect(slugs).toContain("live-beta");
      // The stale on-box snapshot is NOT consulted for registry truth.
      expect(slugs).not.toContain("stale-alpha");
      expect(slugs).toEqual(["live-beta"]);
      // Positive control: the assertions above are only meaningful if the
      // configured registry was actually reached. A zero here would mean the
      // stub never fired and the test proved nothing.
      expect(registryRequests).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = realFetch;
      restoreRegistryEnv(savedEnv);
      closeDatabase();
      __resetProjectStore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an explicitly injected db stays authoritative for that call", async () => {
    // The `db` option is a deliberate local override (tests, embedded callers).
    // Routing the default path through the store seam must not break it.
    const root = join(tmpdir(), `projects-reports-injected-${randomUUID()}`);
    const savedEnv = captureRegistryEnv();
    const realFetch = globalThis.fetch;
    const db = makeDb();
    try {
      process.env["HASNA_PROJECTS_API_URL"] = "https://projects.test.invalid";
      process.env["HASNA_PROJECTS_API_KEY"] = "test-registry-key";
      globalThis.fetch = (async () => {
        throw new Error("injected db must not reach the network");
      }) as unknown as typeof globalThis.fetch;

      makeReportsProject(db, root, {
        id: "wks_injected",
        slug: "injected",
        name: "Injected Project",
        reports: { "2026-07-04": { "daily.md": "# injected" } },
      });

      __resetProjectStore();
      const indexed = await listProjectsWithReports({ db });
      expect(indexed.map((item) => item.project.slug)).toEqual(["injected"]);
    } finally {
      globalThis.fetch = realFetch;
      restoreRegistryEnv(savedEnv);
      __resetProjectStore();
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
