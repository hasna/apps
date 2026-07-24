import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const smokeScript = new URL("./container-http-smoke.ts", import.meta.url).pathname;
const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const token = "container-smoke-test-token";
let server: ReturnType<typeof Bun.serve>;
const projectNames = new Set<string>();

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const authorized = request.headers.get("x-api-key") === token;
      if (url.pathname === "/health" || url.pathname === "/ready") return Response.json({ ok: true });
      if (url.pathname === "/version") return Response.json({ version: packageVersion.version });
      if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });

      if (url.pathname === "/v1/tasks" && request.method === "POST") {
        return Response.json({ task: { id: "smoke-task", version: 1 } }, { status: 201 });
      }
      if (url.pathname === "/v1/tasks/smoke-task" && request.method === "GET") {
        return Response.json({ task: { id: "smoke-task" } });
      }
      if (url.pathname === "/v1/tasks/smoke-task" && request.method === "PATCH") {
        const body = request.json() as Promise<{ status?: string; version?: number }>;
        return body.then((input) => input.status === "done" && input.version === 1
          ? Response.json({ error: "conflict" }, { status: 409 })
          : Response.json({ task: { id: "smoke-task" } }));
      }
      if (url.pathname === "/v1/tasks/smoke-task" && request.method === "DELETE") {
        return Response.json({ ok: true });
      }
      if (url.pathname === "/v1/projects" && request.method === "POST") {
        const body = request.json() as Promise<{ name?: string }>;
        return body.then((input) => {
          if (!input.name?.startsWith("Container Smoke ") || projectNames.has(input.name)) {
            return Response.json({ error: "duplicate" }, { status: 409 });
          }
          projectNames.add(input.name);
          return Response.json({ project: { id: "smoke-project" } }, { status: 201 });
        });
      }
      if (url.pathname === "/v1/projects" && request.method === "GET") {
        return Response.json({ projects: [] });
      }
      if (url.pathname === "/v1/projects/smoke-project/rename" && request.method === "POST") {
        return Response.json({ project: { id: "smoke-project" } });
      }
      if (url.pathname === "/v1/projects/smoke-project" && request.method === "DELETE") {
        return Response.json({ ok: true });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
});

afterAll(() => server.stop(true));

async function runSmoke(expectedVersion?: string) {
  const child = Bun.spawn([process.execPath, smokeScript], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH,
      TODOS_V1_BASE_URL: `http://127.0.0.1:${server.port}`,
      TODOS_V1_TOKEN: token,
      ...(expectedVersion === undefined ? {} : { TODOS_EXPECTED_VERSION: expectedVersion }),
    },
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout, stderr, output: `${stdout}${stderr}` };
}

describe("container HTTP smoke version contract", () => {
  test("accepts the candidate package version supplied by the build", async () => {
    const result = await runSmoke(packageVersion.version);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("container HTTP/auth/CRUD/routing smoke: PASS");
  });

  test("rejects missing, invalid, and mismatched expected versions before a false-positive smoke pass", async () => {
    const missing = await runSmoke();
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("TODOS_EXPECTED_VERSION is required");

    const invalid = await runSmoke("invalid-version");
    expect(invalid.status).not.toBe(0);
    expect(invalid.output).toContain("TODOS_EXPECTED_VERSION must be a valid semver version");

    for (const invalidPrerelease of ["0.11.96-01", "0.11.96-rc.01"]) {
      const invalid = await runSmoke(invalidPrerelease);
      expect(invalid.status).not.toBe(0);
      expect(invalid.output).toContain("TODOS_EXPECTED_VERSION must be a valid semver version");
    }

    const mismatchVersion = `${packageVersion.version}-mismatch`;
    const mismatch = await runSmoke(mismatchVersion);
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.output).toContain(`/version: expected ${mismatchVersion}, got ${packageVersion.version}`);
  });
});
