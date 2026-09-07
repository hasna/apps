import { describe, expect, test } from "bun:test";
import { getTodosCliOnBoxStoreCommands, initializeTodosCliAuthority } from "./stage-a.js";

/**
 * THE CONSTRAINT THAT IS INVISIBLE FROM `--help`, and the single most important
 * one in this change.
 *
 * The command catalog is transport-neutral: every verb is registered,
 * advertised and executed in every transport. The STORE a verb serves is a
 * property of its data plane — `delegate` hands a filed task to a worker on
 * the SHARED dataset, so it must route to the hosted store whenever a hosted
 * authority is configured; `dispatch` types into a tmux pane, so it serves
 * the on-box store.
 *
 * A `delegate` that fell into the on-box store set would route away from the
 * fleet it was built for, and nothing in the command's local tests would
 * reveal that. Hence a test against the store classification itself.
 */

const HOSTED_ENV = {
  HASNA_TODOS_API_URL: "https://authority.invalid",
  HASNA_TODOS_API_KEY: "fixture-remote-key",
};

describe("delegate routes to the hosted store whenever a hosted authority is configured", () => {
  const onBox = getTodosCliOnBoxStoreCommands();

  test("delegate is a KNOWN command — absent from the registry it would be UNKNOWN_COMMAND", () => {
    expect(() => initializeTodosCliAuthority(["delegate", "TASK", "worker"], HOSTED_ENV)).not.toThrow();
  });

  test("delegate serves the hosted store, so it never falls into the on-box set", () => {
    expect(onBox.has("delegate")).toBe(false);
    expect(initializeTodosCliAuthority(["delegate", "TASK", "worker"], HOSTED_ENV).route).toBe("remote-http");
  });

  test("CONTROL: dispatch is registered and serves the on-box store, which is exactly the split being avoided", () => {
    // `dispatch` types into a tmux pane and carries a scheduler, a history
    // verb and two SQLite tables, so it stays on the on-box store. If it ever
    // flips, either someone made it hosted — a change operating rule 12
    // forbids — or this test is reading a classification that no longer means
    // what it says.
    expect(onBox.has("dispatch")).toBe(true);
    expect(onBox.has("dispatches")).toBe(true);
    expect(initializeTodosCliAuthority(["dispatch"], HOSTED_ENV).route).toBe("local");
  });

  test("CONTROL: a name that was never registered is absent, so `has` is not answering true to everything", () => {
    expect(onBox.has("delegate-nonexistent-control")).toBe(false);
  });

  test("CONTROL: an established hosted verb routes the same way delegate does", () => {
    expect(onBox.has("assign")).toBe(false);
    expect(initializeTodosCliAuthority(["assign", "TASK", "worker"], HOSTED_ENV).route).toBe("remote-http");
  });
});