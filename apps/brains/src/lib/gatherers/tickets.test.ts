// agent-authored (no SOL consult available)

import { describe, expect, test, mock } from "bun:test";
import { gatherFromTickets } from "./tickets.js";

// Per-test SDK fixture state, read at call time by the mocked module.
const sdkState: { tickets: unknown[]; throwOnList?: boolean } = { tickets: [] };

describe("gatherFromTickets", () => {
  test("returns an empty result when the SDK package is not installed", async () => {
    mock.module("@hasna/tickets", () => {
      throw new Error("module not found");
    });
    const result = await gatherFromTickets();
    expect(result.source).toBe("tickets");
    expect(result.examples).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("builds a three-message example per ticket", async () => {
    mock.module("@hasna/tickets", () => ({
      listTickets: async () => {
        if (sdkState.throwOnList) throw new Error("boom");
        return sdkState.tickets;
      },
    }));
    sdkState.throwOnList = false;
    sdkState.tickets = [
      { id: "t1", title: "Login broken", status: "open", priority: "high", description: "Cannot log in" },
    ];

    const result = await gatherFromTickets();
    expect(result.count).toBe(1);
    const example = result.examples[0]!;
    expect(example.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(example.messages[0]?.content).toContain("issue management");
    expect(example.messages[1]?.content).toBe('What is the status of ticket "Login broken"?');
    expect(example.messages[2]?.content).toBe(
      'Ticket "Login broken" [open/high]: Cannot log in',
    );
  });

  test("falls back to id, defaults for status/priority, and a no-description marker", async () => {
    sdkState.tickets = [{ id: "t9" }];
    const result = await gatherFromTickets();
    expect(result.count).toBe(1);
    const example = result.examples[0]!;
    expect(example.messages[1]?.content).toBe('What is the status of ticket "t9"?');
    expect(example.messages[2]?.content).toBe(
      'Ticket "t9" [open/medium]: (no description)',
    );
  });

  test("respects the limit when slicing tickets", async () => {
    sdkState.tickets = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}` }));
    const result = await gatherFromTickets({ limit: 3 });
    expect(result.count).toBe(3);
    expect(result.examples[0]?.messages[1]?.content).toContain('"t0"');
    expect(result.examples[2]?.messages[1]?.content).toContain('"t2"');
  });

  test("a throwing listTickets degrades to an empty result", async () => {
    sdkState.throwOnList = true;
    const result = await gatherFromTickets();
    expect(result.source).toBe("tickets");
    expect(result.count).toBe(0);
  });
});
