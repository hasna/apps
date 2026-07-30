import { describe, expect, test } from "bun:test";
import { InMemoryAccountsRepository } from "../../src/storage/memory";
import {
  makeFixtureGraph,
  makeTestRecoveryLedger,
  mutationContext,
  TEST_CREDENTIAL_USE_AUTHORIZER,
  TEST_CREDENTIAL_VERIFIER,
} from "../fixtures";

function makeRepository(): InMemoryAccountsRepository {
  return new InMemoryAccountsRepository(
    TEST_CREDENTIAL_VERIFIER,
    makeTestRecoveryLedger(),
    TEST_CREDENTIAL_USE_AUTHORIZER,
  );
}

describe("in-memory accounts repository", () => {
  test("stores cloned records and replays an identical insert", async () => {
    const repository = makeRepository();
    const graph = makeFixtureGraph("api_key", 301);
    const context = mutationContext("memory:insert");

    const first = await repository.insert("account", graph.account, context);
    const replay = await repository.insert("account", graph.account, context);
    const stored = await repository.get("account", graph.account.id);

    expect(first).toMatchObject({ record: graph.account, replayed: false });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(stored).toEqual(graph.account);
    expect(stored).not.toBe(first.record);
    expect(await repository.list("account")).toEqual([graph.account]);
    expect(await repository.events()).toHaveLength(1);
    expect(await repository.outbox()).toHaveLength(1);
  });

  test("rejects changed input under the same idempotency scope", async () => {
    const repository = makeRepository();
    const graph = makeFixtureGraph("api_key", 302);
    const context = mutationContext("memory:idempotency-conflict");
    await repository.insert("account", graph.account, context);

    await expect(
      repository.insert(
        "account",
        { ...graph.account, displayLabel: "Changed account" },
        context,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  test("returns empty reads and refuses credential ingestion without recovery", async () => {
    const repository = new InMemoryAccountsRepository();
    const graph = makeFixtureGraph("api_key", 303);

    expect(await repository.get("account", graph.account.id)).toBeUndefined();
    expect(await repository.readEligibilitySnapshot(graph.method.id)).toMatchObject({
      capsules: [],
      bindings: [],
      recovery: { matched: false, hold: true },
    });
    await expect(
      repository.insertCredentialBinding(
        graph.binding,
        graph.handle,
        mutationContext("memory:recovery-hold"),
      ),
    ).rejects.toMatchObject({ code: "RECOVERY_HOLD" });
  });

  test("refuses all reads after close", async () => {
    const repository = makeRepository();
    await repository.close();

    await expect(repository.list("account")).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      details: { adapter: "memory" },
    });
    await expect(repository.doctor()).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });
});
