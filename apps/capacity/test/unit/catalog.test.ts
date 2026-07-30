import { describe, expect, test } from "bun:test";
import { AccountsCatalog } from "../../src/domain/catalog";
import { InMemoryAccountsRepository } from "../../src/storage/memory";
import {
  C0,
  clock,
  makeFixtureGraph,
  makeTestRecoveryLedger,
  mutationContext,
  TEST_AUTHORITY_POLICY,
  TEST_CREDENTIAL_USE_AUTHORIZER,
  TEST_CREDENTIAL_VERIFIER,
} from "../fixtures";

function makeCatalog(authority = true): AccountsCatalog {
  const repository = new InMemoryAccountsRepository(
    TEST_CREDENTIAL_VERIFIER,
    makeTestRecoveryLedger(),
    TEST_CREDENTIAL_USE_AUTHORIZER,
  );
  return new AccountsCatalog(
    repository,
    clock,
    authority ? TEST_AUTHORITY_POLICY : undefined,
  );
}

describe("accounts catalog", () => {
  test("adds, reads, lists, and idempotently replays an account", async () => {
    const catalog = makeCatalog();
    const graph = makeFixtureGraph("api_key", 311);
    const context = mutationContext("catalog:add");

    const first = await catalog.add("account", graph.account, context);
    const replay = await catalog.add("account", graph.account, context);

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await catalog.get("account", graph.account.id)).toEqual(graph.account);
    expect(await catalog.list("account")).toEqual([graph.account]);
  });

  test("translates missing records and invalid initial state into domain errors", async () => {
    const catalog = makeCatalog();
    const graph = makeFixtureGraph("api_key", 312);

    await expect(catalog.get("account", graph.account.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { aggregateKind: "account", aggregateId: graph.account.id },
    });
    await expect(
      catalog.add(
        "account",
        graph.activeAccount,
        mutationContext("catalog:invalid-initial-state"),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  test("requires configured authority verification for ownership activation", async () => {
    const catalog = makeCatalog(false);
    const graph = makeFixtureGraph("api_key", 313);
    await catalog.add("account", graph.account, mutationContext("catalog:no-authority:add"));

    await expect(
      catalog.activateProviderAccount(
        graph.activeAccount,
        graph.ownershipEvidence,
        graph.ownershipFence,
        C0,
        mutationContext("catalog:no-authority:activate"),
      ),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });

  test("activates verified ownership and rejects a stale later transition", async () => {
    const catalog = makeCatalog();
    const graph = makeFixtureGraph("api_key", 314);
    await catalog.add("account", graph.account, mutationContext("catalog:activate:add"));

    const activated = await catalog.activateProviderAccount(
      graph.activeAccount,
      graph.ownershipEvidence,
      graph.ownershipFence,
      C0,
      mutationContext("catalog:activate:verified"),
    );

    expect(activated).toMatchObject({ record: graph.activeAccount, replayed: false });
    await expect(
      catalog.transition(
        "account",
        graph.account.id,
        "suspended",
        C0,
        mutationContext("catalog:stale-transition"),
      ),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(await catalog.doctor()).toMatchObject({ adapter: "memory", integrity: "ok" });

    await catalog.close();
    await expect(catalog.list("account")).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });
});
