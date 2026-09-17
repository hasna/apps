import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("open-core hosted service pattern", () => {
  const content = readFileSync(join(process.cwd(), "docs/architecture/open-core-saas-pattern.md"), "utf8");

  test("keeps hosted server implementation outside OSS packages", () => {
    expect(content).toContain("server-aware");
    expect(content).toContain("local");
    expect(content).toContain("OAuth provider secrets");
    expect(content).toContain("Stripe webhook handlers");
    expect(content).toContain("The hosted web app is the account and billing source of truth");
  });

  test("states that the CLI ships no billing or credits namespaces", () => {
    // The CLI registers no billing/credits commands (src/cli/commands/auth.ts
    // registers auth subcommands only; src/lib/no-billing-surface.test.ts pins
    // the shipped serialized surfaces to zero billing vocabulary), so the doc
    // must not list billing/credits as OSS commands.
    expect(content).toContain("no billing or credits command namespaces");
  });

  test("documents hosted discovery authority and explicit local authoring", () => {
    expect(content).toContain("getBrowseRegistry()");
    expect(content).toContain("src/lib/read-access.ts");
    expect(content).toContain("A configured API is authoritative");
    expect(content).toContain("including with `--all` or `--remote`");
    expect(content).toContain("Local drafts and extension folders cannot shadow or join hosted metadata");
    expect(content).toContain("HASNA_SKILLS_LOCAL=1");
    expect(content).toContain("environment variables outrank the local opt-in");
    expect(content).toContain("never fall back to local content");
    expect(content).not.toContain("UNION cloud");
    expect(content).not.toContain("mergeRemoteRegistry()");
    expect(content).not.toContain("browse/list) run on this machine and require no API origin");
  });

  test("separates auth logout from API-backed auth commands", () => {
    // P1 fix (fresh review cycle 0): auth.ts registers logout as local-only
    // credential removal (clearAuthConfig(), no API call), while login, signup,
    // and whoami are API-backed. The doc must not group logout with the
    // remote-client auth commands.
    expect(content).toContain("auth logout");
    expect(content).toContain("local credential removal");
    // Negative control: logout must not be listed among the commands that
    // "call the configured Skills API".
    expect(content).not.toContain("`auth login`, `auth logout`, `auth whoami`");
  });
});
