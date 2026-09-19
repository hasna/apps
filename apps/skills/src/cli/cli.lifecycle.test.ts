import { afterEach, expect, test } from "bun:test";
import { runCli } from "./cli.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

test("lifecycle archive conflict exits nonzero and renders only the typed safe error", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({
    code: "SKILL_ARCHIVE_PROFILE_CONFLICT",
    profiles: ["proof-codewith-install-owner-20260917"],
    message: "server detail must not be rendered",
  }, { status: 409 }) });
  servers.push(server);

  const result = await runCli(["lifecycle", "codewith-install-owner", "--state", "archived", "--revision", "revision-1", "--json"], {
    HASNA_SKILLS_LOCAL: "0",
    HASNA_SKILLS_API_URL: server.url.origin,
    HASNA_SKILLS_API_KEY_OVERRIDE: "fixture-key",
    HASNA_STATION: "skills-lifecycle-fixture",
  });

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toEqual({ error: "Skill lifecycle update was refused (HTTP 409, code SKILL_ARCHIVE_PROFILE_CONFLICT)" });
  expect(result.stdout).not.toContain("proof-codewith");
  expect(result.stdout).not.toContain("server detail");
  expect(result.stderr).toBe("");
});

test("lifecycle archive success exits zero and returns the hosted receipt", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ slug: "fixture", lifecycle: "archived", revisionId: "revision-2" }) });
  servers.push(server);

  const result = await runCli(["lifecycle", "fixture", "--state", "archived", "--revision", "revision-1", "--json"], {
    HASNA_SKILLS_LOCAL: "0",
    HASNA_SKILLS_API_URL: server.url.origin,
    HASNA_SKILLS_API_KEY_OVERRIDE: "fixture-key",
    HASNA_STATION: "skills-lifecycle-fixture",
  });

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ slug: "fixture", lifecycle: "archived", revisionId: "revision-2" });
  expect(result.stderr).toBe("");
});
