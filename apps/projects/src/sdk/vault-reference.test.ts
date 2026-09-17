import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsClientFromEnv } from "./index.js";

test("the installed Secrets SDK resolves environment and durable file references without literal fallback", async () => {
  const home = mkdtempSync(join(tmpdir(), "projects-vault-reference-"));
  const config = join(home, ".hasna/projects/config");
  mkdirSync(config, { recursive: true, mode: 0o700 });
  let mode = "ok", vaultRequests = 0, projectRequests = 0, correctKeys = true;
  const vaultKey = () => mode === "rotate" ? "fixture-vault-rotated" : "fixture-vault-key";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/v1/secrets/get") {
      vaultRequests++;
      correctKeys &&= request.headers.get("x-api-key") === "fixture-bootstrap-key";
      if (mode === "missing") return new Response(null, { status: 404 });
      if (mode === "denied") return new Response(null, { status: 403 });
      return Response.json({ key: "fixture/projects/api-key", value: mode === "empty" ? "" : vaultKey() });
    }
    if (pathname === "/v1/projects") {
      projectRequests++;
      correctKeys &&= request.headers.get("x-api-key") === vaultKey();
      return Response.json({ items: [], total: 0 });
    }
    return new Response(null, { status: 404 });
  } });
  const common = {
    HOME: home,
    HASNA_STATION: "hasna-projects-tests-no-keychain",
    HASNA_PROJECTS_API_URL: server.url.origin,
    HASNA_PROJECTS_API_KEY: "fixture-stale-literal",
    HASNA_SECRETS_API_URL: server.url.origin,
    HASNA_SECRETS_API_KEY: "fixture-bootstrap-key",
  };
  try {
    for (const source of ["environment", "file"] as const) {
      const file = join(config, "credentials");
      if (source === "file") {
        writeFileSync(file, `HASNA_PROJECTS_API_KEY_REF=fixture/projects/api-key\nHASNA_PROJECTS_API_URL=${server.url.origin}\n`, { mode: 0o600 });
      } else rmSync(file, { force: true });
      const env = source === "environment"
        ? { ...common, HASNA_PROJECTS_API_KEY_REF: "fixture/projects/api-key" }
        : { ...common };
      const client = createProjectsClientFromEnv(env);
      for (const next of ["ok", "rotate"]) {
        mode = next; vaultRequests = 0; projectRequests = 0; correctKeys = true;
        await client.listProjects();
        expect(vaultRequests, `${source}: ${next}`).toBe(1);
        expect(projectRequests, `${source}: ${next}`).toBe(1);
        expect(correctKeys, `${source}: ${next}`).toBe(true);
      }
      for (const failure of ["missing", "denied", "empty"]) {
        mode = failure; vaultRequests = 0; projectRequests = 0; correctKeys = true;
        await expect(client.listProjects()).rejects.toThrow();
        expect(vaultRequests, `${source}: ${failure}`).toBe(1);
        expect(projectRequests, `${source}: ${failure}`).toBe(0);
        expect(correctKeys, `${source}: ${failure}`).toBe(true);
      }
    }
  } finally { server.stop(true); rmSync(home, { recursive: true, force: true }); }
});
