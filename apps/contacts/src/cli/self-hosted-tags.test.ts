import { afterEach, describe, expect, test } from "bun:test";

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("contacts tags bulk in self_hosted mode", () => {
  test("looks up the tag and attaches it only through the cloud API", async () => {
    const calls: Array<{ method: string; pathname: string; name: string | null }> = [];
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        calls.push({ method: req.method, pathname: url.pathname, name: url.searchParams.get("name") });
        if (req.method === "GET" && url.pathname === "/v1/tags") {
          return Response.json({ tags: [{ id: "tag-1", name: "monthly-accounting" }], count: 1 });
        }
        if (req.method === "PUT" && url.pathname === "/v1/contacts/contact-1/tags/tag-1") {
          return Response.json({ attached: true, contact_id: "contact-1", tag_id: "tag-1" });
        }
        return Response.json({ error: "unexpected request" }, { status: 404 });
      },
    });

    const env = { ...process.env };
    delete env["CONTACTS_MODE"];
    delete env["CONTACTS_DB_PATH"];
    delete env["HASNA_CONTACTS_DB_PATH"];
    env["HASNA_CONTACTS_STORAGE_MODE"] = "self_hosted";
    env["HASNA_CONTACTS_API_URL"] = `http://127.0.0.1:${server.port}`;
    env["HASNA_CONTACTS_API_KEY"] = "test-api-key";

    const child = Bun.spawn([
      process.execPath,
      "run",
      "src/cli/index.tsx",
      "tags",
      "bulk",
      "add",
      "monthly-accounting",
      "--contact-ids",
      "contact-1",
    ], {
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

    expect(exitCode, stderr).toBe(0);
    expect(stdout).toContain("Tagged 1 contact(s) with #monthly-accounting");
    expect(calls).toEqual([
      { method: "GET", pathname: "/v1/tags", name: "monthly-accounting" },
      { method: "PUT", pathname: "/v1/contacts/contact-1/tags/tag-1", name: null },
    ]);
  });
});
