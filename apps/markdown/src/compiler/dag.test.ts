import { describe, test, expect } from "bun:test";
import { buildDAG, compileExecutionPlan, getEntryPoints, getLeafNodes, DAGCycleError } from "./dag";
import type { OmpCard } from "../types/index.js";

function makeCard(id: string, depends: string[] = []): OmpCard {
  return {
    type: "custom",
    id,
    depends,
    headers: {},
    body: { raw: "", text: "", tables: [], inlineDirectives: [] },
    accepts: [],
    sourceFile: "test.omp.md",
    lineNumber: 1,
  };
}

describe("buildDAG", () => {
  test("builds DAG from cards with no dependencies", () => {
    const cards = [makeCard("a"), makeCard("b"), makeCard("c")];
    const dag = buildDAG(cards);
    expect(dag.nodes.size).toBe(3);
    expect(dag.order).toHaveLength(1); // all in one parallel group
    expect(dag.order[0]).toHaveLength(3);
  });

  test("builds linear chain", () => {
    const cards = [
      makeCard("a"),
      makeCard("b", ["a"]),
      makeCard("c", ["b"]),
    ];
    const dag = buildDAG(cards);
    expect(dag.order).toHaveLength(3);
    expect(dag.order[0]).toEqual(["a"]);
    expect(dag.order[1]).toEqual(["b"]);
    expect(dag.order[2]).toEqual(["c"]);
  });

  test("detects parallel groups (diamond)", () => {
    // a → b, a → c, b → d, c → d
    const cards = [
      makeCard("a"),
      makeCard("b", ["a"]),
      makeCard("c", ["a"]),
      makeCard("d", ["b", "c"]),
    ];
    const dag = buildDAG(cards);
    expect(dag.order).toHaveLength(3);
    expect(dag.order[0]).toEqual(["a"]);
    expect(dag.order[1].sort()).toEqual(["b", "c"]); // parallel
    expect(dag.order[2]).toEqual(["d"]);
  });

  test("detects cycles", () => {
    const cards = [
      makeCard("a", ["c"]),
      makeCard("b", ["a"]),
      makeCard("c", ["b"]),
    ];
    expect(() => buildDAG(cards)).toThrow(DAGCycleError);
  });

  test("handles missing dependency gracefully", () => {
    const cards = [
      makeCard("a"),
      makeCard("b", ["a", "nonexistent"]),
    ];
    // Should not throw — missing deps are ignored (validator catches these)
    const dag = buildDAG(cards);
    expect(dag.order).toHaveLength(2);
  });

  test("handles empty card set", () => {
    const dag = buildDAG([]);
    expect(dag.nodes.size).toBe(0);
    expect(dag.order).toHaveLength(0);
  });

  test("complex DAG with multiple roots and leaves", () => {
    const cards = [
      makeCard("init"),
      makeCard("db", ["init"]),
      makeCard("auth", ["db"]),
      makeCard("api-notes", ["auth"]),
      makeCard("api-tags", ["auth"]),
      makeCard("ui-layout", ["init"]),
      makeCard("ui-list", ["ui-layout", "api-notes"]),
      makeCard("ui-editor", ["ui-layout", "api-notes", "api-tags"]),
      makeCard("seed", ["db", "auth"]),
    ];
    const dag = buildDAG(cards);

    // init and no-dep nodes first
    expect(dag.order[0]).toEqual(["init"]);

    // Verify all nodes are scheduled
    const allScheduled = dag.order.flat();
    expect(allScheduled.sort()).toEqual(cards.map((c) => c.id).sort());
  });
});

describe("compileExecutionPlan", () => {
  test("creates plan from DAG", () => {
    const cards = [
      makeCard("a"),
      makeCard("b", ["a"]),
      makeCard("c", ["a"]),
    ];
    const dag = buildDAG(cards);
    const plan = compileExecutionPlan(dag);
    expect(plan.totalCards).toBe(3);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1].description).toContain("parallel");
  });
});

describe("getEntryPoints", () => {
  test("returns nodes with no dependencies", () => {
    const cards = [makeCard("a"), makeCard("b", ["a"])];
    const dag = buildDAG(cards);
    expect(getEntryPoints(dag)).toEqual(["a"]);
  });
});

describe("getLeafNodes", () => {
  test("returns nodes nothing depends on", () => {
    const cards = [
      makeCard("a"),
      makeCard("b", ["a"]),
      makeCard("c", ["a"]),
    ];
    const dag = buildDAG(cards);
    const leaves = getLeafNodes(dag).sort();
    expect(leaves).toEqual(["b", "c"]);
  });
});
