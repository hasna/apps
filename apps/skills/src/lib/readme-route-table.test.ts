/**
 * readme-route-table.test.ts — keeps the README API route table honest.
 *
 * The README is the reading agent's first surface for "what does this package
 * serve". The route table there must list every route the shipped server
 * actually serves (src/server/app.ts), and must mark the routes that are
 * client-contract only or not shipped — a route silently missing from the
 * table is a reading agent told a false story about the package.
 *
 * Guarding philosophy mirrors readme-derived-counts.test.ts: the route list is
 * the claim, and a claim is only guarded when the guard can fail. Dropping a
 * served route from the README table fails this file; advertising a route the
 * package does not serve is caught by the reviewer/plan, not here.
 */
import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const README_PATH = new URL("../../README.md", import.meta.url).pathname;

/**
 * Every route the shipped server serves. Mirrors src/server/app.ts
 * (createSkillsFetchHandler/handleApiV1); add a row here when the server gains
 * a route, and to the README table — this list fails if the README drops one.
 */
const SERVED_ROUTES = [
  "GET /health",
  "GET /ready",
  "GET /api/auth/whoami",
  "GET /api/v1/skills",
  "POST /api/v1/skills",
  "GET /api/v1/skills/:slug",
  "PUT /api/v1/skills/:slug",
  "PATCH /api/v1/skills/:slug",
  "DELETE /api/v1/skills/:slug",
  "GET /api/v1/skills/:slug/skill.md",
  "GET /api/v1/skills/:slug/bundle",
  "GET /api/v1/runs",
  "POST /api/v1/runs/:slug",
  "GET /api/v1/runs/:runId",
  "GET /api/v1/runs/:runId/logs",
  "GET /api/v1/runs/:runId/artifacts",
  "GET /api/v1/runs/:runId/artifacts/:artifactId",
  "POST /api/v1/runs/:runId/cancel",
];

describe("README.md API route table", () => {
  test("lists every served route", async () => {
    const readme = await Bun.file(README_PATH).text();
    const missing = SERVED_ROUTES.filter((route) => !readme.includes(route));
    expect(missing).toEqual([]);
  });

  test("marks client-contract and not-shipped routes honestly", async () => {
    const readme = await Bun.file(README_PATH).text();
    // pins/tags/updated-since exist on the client (RemoteSkillsClient) with a
    // fail-closed version-skew guard; the server routes are not served yet.
    expect(readme).toContain("client-contract");
    // The local↔registry reconciliation verb is not shipped (plan task T9 pending).
    expect(readme).toContain("not shipped");
  });
});
