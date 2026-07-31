// The TypeScript half of a shared expectation with the macOS shell.
//
// test-fixtures/store-resolution-matrix.json names, per arm, the environment the
// shell inherits, the store the shell must announce, and the exact
// store-selecting keys the shell hands the child server. The Swift suite
// (Tests/HasnaConversationsCoreTests) asserts the shell half. This file asserts
// the other half: that THIS resolver — the one the child actually runs — reaches
// the store the shell announced, from the environment the shell built.
//
// That pairing is the whole point. The two resolvers cannot call each other, so
// before this fixture existed the only thing keeping them in step was that
// somebody had read both. They were not in step: the shell announced hosted while
// this resolver selected local, for five different environment variables.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertUnambiguousStoreEnv, resolveConversationsCloud } from "./index.js";

interface Arm {
  name: string;
  note?: string;
  configFile: Record<string, string> | null;
  environment: Record<string, string>;
  shell: "cloud" | "local" | "unresolved";
  announcedUrl?: string;
  childStoreEnv?: Record<string, string>;
  childStore?: "cloud" | "local";
  reasonContains?: string;
}

const repoRoot = join(import.meta.dir, "..", "..", "..");
const matrix = JSON.parse(
  readFileSync(join(repoRoot, "test-fixtures/store-resolution-matrix.json"), "utf8"),
) as { arms: Arm[] };

/** Which store this resolver selects for an env — exactly what `getStore` branches on. */
function storeFor(env: Record<string, string>): "cloud" | "local" {
  assertUnambiguousStoreEnv(env);
  return resolveConversationsCloud(env) ? "cloud" : "local";
}

describe("store resolution matrix (shared with the macOS shell)", () => {
  test("the fixture actually loaded", () => {
    // A matrix-driven suite that loads zero arms passes vacuously.
    expect(matrix.arms.length).toBeGreaterThanOrEqual(18);
  });

  const started = matrix.arms.filter((a) => a.childStoreEnv && a.childStore);

  test("every arm that starts a child is covered", () => {
    // Guards the same vacuity from the other direction: if a future edit drops
    // `childStoreEnv` from the arms, the loop below would silently assert nothing.
    expect(started.length).toBeGreaterThanOrEqual(13);
  });

  for (const arm of started) {
    test(`${arm.name}: the child env the shell builds resolves to ${arm.childStore}`, () => {
      expect(storeFor(arm.childStoreEnv!)).toBe(arm.childStore!);
    });

    test(`${arm.name}: the shell's announcement matches the store the child resolves`, () => {
      // The invariant the divergence broke. `local` on the shell side and
      // `local` here are the same claim; `cloud` likewise.
      expect(arm.childStore).toBe(arm.shell === "cloud" ? "cloud" : "local");
    });
  }

  test("an unresolved arm starts no child, so there is nothing to disagree about", () => {
    const unresolved = matrix.arms.filter((a) => a.shell === "unresolved");
    expect(unresolved.length).toBeGreaterThanOrEqual(5);
    for (const arm of unresolved) {
      expect(arm.childStoreEnv).toBeUndefined();
    }
  });

  test("the child-env assertion can fail", () => {
    // Positive control: the same check must reject an environment that reaches
    // the other store. Without it, `storeFor` returning "local" for everything
    // would pass every local arm.
    expect(storeFor({ HASNA_CONVERSATIONS_DB_PATH: "/tmp/x.db" })).toBe("local");
    expect(
      storeFor({
        HASNA_CONVERSATIONS_API_URL: "https://conversations.hasna.xyz/v1",
        HASNA_CONVERSATIONS_API_KEY: "fixture-not-a-real-credential",
      }),
    ).toBe("cloud");
  });

  test("the pre-fix child env is what this resolver would have served: local", () => {
    // The regression, pinned. Before the fix the shell forwarded the inherited
    // environment untouched, so a DB_PATH alongside a valid url + key reached the
    // child — and this resolver puts DB_PATH at the highest precedence. The shell
    // said hosted; the child answered from the on-box SQLite file.
    const preFixChildEnv = {
      HASNA_CONVERSATIONS_API_URL: "https://conversations.hasna.xyz/v1",
      HASNA_CONVERSATIONS_API_KEY: "fixture-not-a-real-credential",
      HASNA_CONVERSATIONS_DB_PATH: "/tmp/fixture-conversations.db",
    };
    expect(storeFor(preFixChildEnv)).toBe("local");

    // And the same env with the store-selecting keys rebuilt the way the shell
    // now does it resolves to the store it announces.
    const postFixChildEnv = {
      HASNA_CONVERSATIONS_API_URL: "https://conversations.hasna.xyz/v1",
      HASNA_CONVERSATIONS_API_KEY: "fixture-not-a-real-credential",
    };
    expect(storeFor(postFixChildEnv)).toBe("cloud");
  });
});
