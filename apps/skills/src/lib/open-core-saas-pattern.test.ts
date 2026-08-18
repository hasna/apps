import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("open-core hosted service pattern", () => {
  const content = readFileSync(join(process.cwd(), "docs/architecture/open-core-saas-pattern.md"), "utf8");

  test("ships the user-hosted server inside the OSS package", () => {
    // The shipped reality: `skills-server`/`skills-worker`/`skills-migrate` ship in
    // the OSS package (bin entries, src/server, migrations/) — the pattern doc must
    // say so, not reserve the server for a private wrapper.
    expect(content).toContain("skills-server");
    expect(content).toContain("ships in the OSS package");
    expect(content).toContain("server-aware");
    expect(content).toContain("local");
    expect(content).toContain("billing status");
    expect(content).toContain("OAuth provider secrets");
    expect(content).toContain("Stripe webhook handlers");
    expect(content).toContain("The hosted web app is the account and billing source of truth");
  });
});
