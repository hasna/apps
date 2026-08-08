import { afterEach, describe, expect, test } from "bun:test";

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

async function runContacts(args: string[], env: Record<string, string>) {
  const child = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", ...args], {
    cwd: import.meta.dir + "/../..",
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("contacts projects in cloud mode", () => {
  test("attaches, lists, and detaches only through the authenticated API", async () => {
    const calls: Array<{ method: string; pathname: string }> = [];
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        calls.push({ method: req.method, pathname: url.pathname });
        if (req.method === "PUT" && url.pathname === "/v1/contacts/contact-1/projects/project-1") {
          return Response.json({ attached: true, contact_id: "contact-1", project_id: "project-1" });
        }
        if (req.method === "GET" && url.pathname === "/v1/contacts/contact-1/projects") {
          return Response.json({ contact_id: "contact-1", project_ids: ["project-1"] });
        }
        if (req.method === "DELETE" && url.pathname === "/v1/contacts/contact-1/projects/project-1") {
          return Response.json({ removed: true, contact_id: "contact-1", project_id: "project-1" });
        }
        return Response.json({ error: "unexpected request" }, { status: 404 });
      },
    });

    const env = { ...process.env } as Record<string, string>;
    delete env["CONTACTS_DB_PATH"];
    delete env["HASNA_CONTACTS_DB_PATH"];
    env["HASNA_CONTACTS_STORAGE_MODE"] = "cloud";
    env["HASNA_CONTACTS_API_URL"] = `http://127.0.0.1:${server.port}`;
    env["HASNA_CONTACTS_API_KEY"] = "test-key";

    const attach = await runContacts(["projects", "attach", "contact-1", "project-1"], env);
    expect(attach.exitCode, attach.stderr).toBe(0);
    expect(attach.stdout).toContain("Attached contact-1 to project project-1");

    const list = await runContacts(["projects", "list", "contact-1", "--json"], env);
    expect(list.exitCode, list.stderr).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual({
      contact_id: "contact-1",
      project_ids: ["project-1"],
    });

    const detach = await runContacts(["projects", "detach", "contact-1", "project-1"], env);
    expect(detach.exitCode, detach.stderr).toBe(0);
    expect(detach.stdout).toContain("Detached contact-1 from project project-1");

    expect(calls).toEqual([
      { method: "PUT", pathname: "/v1/contacts/contact-1/projects/project-1" },
      { method: "GET", pathname: "/v1/contacts/contact-1/projects" },
      { method: "DELETE", pathname: "/v1/contacts/contact-1/projects/project-1" },
    ]);
  });
});
