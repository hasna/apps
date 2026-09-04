import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * Regression test for O15-00736 — messages-serve defaults to 127.0.0.1:8081
 * (src/server/serve-entry.ts: `HOST = process.env.HASNA_MESSAGES_HOST ??
 * "127.0.0.1"`), and the messages image did not set HASNA_MESSAGES_HOST, so a
 * hosted (oss-fleet-prod ECS, behind the shared ALB) deploy binds loopback
 * only: the ALB can never reach the container and every messages deploy was
 * blocked.
 *
 * The image must default the bind host to 0.0.0.0 so the container is
 * reachable from the ALB — the same convention every sibling deployable image
 * follows (notes: HASNA_NOTES_SERVER_HOST=0.0.0.0, workflows:
 * HASNA_WORKFLOWS_HOST=0.0.0.0, economy: ECONOMY_HOST=0.0.0.0, ...). The
 * unauthenticated-trust boundary stays intact: serve-entry's assertSafeBind
 * refuses a non-loopback bind with no credential configured, which the
 * deploy's task-def env supplies at runtime.
 *
 * This test pins the image contract: the Dockerfile must set the bind host to
 * 0.0.0.0. A regression that removes or renames the ENV fails CI.
 */

const dockerfilePath = new URL("../Dockerfile", import.meta.url);
const dockerfile = readFileSync(dockerfilePath, "utf8");

describe("messages image bind-host contract (O15-00736)", () => {
  test("defaults the serve bind host to 0.0.0.0 in the image", () => {
    expect(dockerfile).toContain("HASNA_MESSAGES_HOST=0.0.0.0");
  });
});
