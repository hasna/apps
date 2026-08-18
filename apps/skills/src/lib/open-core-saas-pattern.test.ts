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

  test("documents the browse/list registry merge accurately", () => {
    // P1 fix: getBrowseRegistry() (src/cli/commands/list.ts) merges the
    // configured API registry on the default read path via mergeRemoteRegistry()
    // (src/lib/remote-registry.ts) whenever an origin and credential are
    // configured, and fails closed (local only) otherwise. The doc must
    // classify browse/list (list/ls, search/s, categories, tags) as
    // server-aware, never as local-only.
    expect(content).toContain("getBrowseRegistry");
    expect(content).toContain("mergeRemoteRegistry");
    expect(content).toContain("fail closed");
    expect(content).toContain("UNION cloud");
    // Negative control: the terminated candidate's false claim — that
    // browse/list "run on this machine and require no API origin" — must not
    // reappear.
    expect(content).not.toContain("browse/list) run on this machine and require no API origin");
  });
});
