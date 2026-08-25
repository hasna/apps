/**
 * Regression tests for the graph language v1 + validate (slice A).
 * The `while` node is part of the language per the owner amendment 2026-08-25.
 */
import { describe, expect, test } from "bun:test";
import {
  type WorkflowGraph,
  validateGraph,
  collectEdges,
  findNode,
  reachableNodes,
  findCycles,
} from "./graph.js";

function baseGraph(overrides: Partial<WorkflowGraph> = {}): WorkflowGraph {
  return {
    name: "demo",
    version: "1.0.0",
    nodes: [
      { id: "start", type: "start", next: "build" },
      { id: "build", type: "step", lane: "claude", prompt: "build the thing", next: "retry" },
      { id: "retry", type: "decision", condition: "steps.build.exitCode == 0", then: "done", else: "fail" },
      { id: "done", type: "end" },
      { id: "fail", type: "end" },
    ],
    ...overrides,
  };
}

describe("validateGraph", () => {
  test("accepts a well-formed graph", () => {
    const result = validateGraph(baseGraph());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("rejects an empty node list", () => {
    const result = validateGraph({ name: "x", version: "1.0.0", nodes: [] });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "nodes" && i.message.includes("at least one"))).toBe(true);
  });

  test("rejects a missing start node", () => {
    const result = validateGraph({ name: "x", version: "1.0.0", nodes: [{ id: "a", type: "step", prompt: "p", next: "e" }, { id: "e", type: "end" }] });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("start"))).toBe(true);
  });

  test("rejects more than one start node", () => {
    const g = baseGraph();
    g.nodes.push({ id: "start2", type: "start", next: "done" });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("exactly one start"))).toBe(true);
  });

  test("rejects a missing end node", () => {
    const g = baseGraph({ nodes: [{ id: "start", type: "start", next: "build" }, { id: "build", type: "step", prompt: "p" }] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("end"))).toBe(true);
  });

  test("rejects duplicate ids", () => {
    const g = baseGraph();
    g.nodes.push({ id: "build", type: "step", prompt: "dup" });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("duplicate"))).toBe(true);
  });

  test("rejects invalid id characters", () => {
    const g = baseGraph({ nodes: [{ id: "bad id!", type: "start", next: "e" }, { id: "e", type: "end" }] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("id"))).toBe(true);
  });

  test("rejects an edge to a nonexistent node", () => {
    const g = baseGraph({ nodes: [{ id: "start", type: "start", next: "ghost" }, { id: "e", type: "end" }] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("ghost"))).toBe(true);
  });

  test("rejects a step with neither prompt nor command", () => {
    const g = baseGraph({ nodes: [
      { id: "start", type: "start", next: "s" },
      { id: "s", type: "step" as const },
      { id: "e", type: "end" },
    ] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "nodes.s" && i.message.includes("prompt"))).toBe(true);
  });

  test("rejects a decision without a condition", () => {
    const g = baseGraph({ nodes: [
      { id: "start", type: "start", next: "d" },
      { id: "d", type: "decision" as const, then: "e", else: "e", condition: undefined as unknown as string },
      { id: "e", type: "end" },
    ] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "nodes.d" && i.message.includes("condition"))).toBe(true);
  });

  test("rejects a decision with neither then nor else", () => {
    const g = baseGraph({ nodes: [
      { id: "start", type: "start", next: "d" },
      { id: "d", type: "decision" as const, condition: "true" },
      { id: "e", type: "end" },
    ] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
  });

  test("rejects a while node without a condition", () => {
    const g = baseGraph({ nodes: [
      { id: "start", type: "start", next: "w" },
      { id: "w", type: "while" as const, body: ["s"], maxIterations: 3, next: "e", condition: undefined as unknown as string },
      { id: "s", type: "step", prompt: "work" },
      { id: "e", type: "end" },
    ] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "nodes.w" && i.message.includes("condition"))).toBe(true);
  });

  test("rejects a while node without maxIterations (SOL finite-budget rule)", () => {
    const g = baseGraph({ nodes: [
      { id: "start", type: "start", next: "w" },
      { id: "w", type: "while" as const, condition: "i < 3", body: ["s"], next: "e", maxIterations: undefined as unknown as number },
      { id: "s", type: "step", prompt: "work" },
      { id: "e", type: "end" },
    ] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "nodes.w" && i.message.includes("maxIterations"))).toBe(true);
  });

  test("rejects a while node with an empty body", () => {
    const g = baseGraph({ nodes: [
      { id: "start", type: "start", next: "w" },
      { id: "w", type: "while" as const, condition: "i < 3", body: [], maxIterations: 3, next: "e" },
      { id: "e", type: "end" },
    ] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "nodes.w" && i.message.includes("body"))).toBe(true);
  });

  test("rejects a while body node id that does not exist", () => {
    const g = baseGraph({ nodes: [
      { id: "start", type: "start", next: "w" },
      { id: "w", type: "while" as const, condition: "i < 3", body: ["ghost"], maxIterations: 3, next: "e" },
      { id: "e", type: "end" },
    ] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("ghost"))).toBe(true);
  });

  test("rejects a nested while or start/end inside a while body (v1 bound)", () => {
    const g = baseGraph({ nodes: [
      { id: "start", type: "start", next: "w" },
      { id: "w", type: "while" as const, condition: "i < 3", body: ["w2"], maxIterations: 3, next: "e" },
      { id: "w2", type: "while" as const, condition: "true", body: ["s"], maxIterations: 2 },
      { id: "s", type: "step", prompt: "work" },
      { id: "e", type: "end" },
    ] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("body"))).toBe(true);
  });

  test("rejects a body node edge leaving the body", () => {
    const g = baseGraph({ nodes: [
      { id: "start", type: "start", next: "w" },
      { id: "w", type: "while" as const, condition: "i < 3", body: ["s"], maxIterations: 3, next: "e" },
      { id: "s", type: "step", prompt: "work", next: "e" },
      { id: "e", type: "end" },
    ] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("body"))).toBe(true);
  });

  test("rejects an explicit graph cycle", () => {
    const g = baseGraph({ nodes: [
      { id: "start", type: "start", next: "a" },
      { id: "a", type: "step", prompt: "a", next: "b" },
      { id: "b", type: "step", prompt: "b", next: "a" },
      { id: "e", type: "end" },
    ] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("cycle"))).toBe(true);
  });

  test("rejects unreachable nodes", () => {
    const g = baseGraph();
    g.nodes.push({ id: "orphan", type: "step", prompt: "never reached" });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "nodes.orphan" && i.message.includes("unreachable"))).toBe(true);
  });

  test("accepts a while loop graph (while node is a first-class language member)", () => {
    const g: WorkflowGraph = {
      name: "retry-until-green",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "w" },
        {
          id: "w",
          type: "while",
          condition: "steps.check.ok != true",
          body: ["work", "check"],
          maxIterations: 5,
          next: "done",
        },
        { id: "work", type: "step", lane: "claude", prompt: "fix it" },
        { id: "check", type: "step", command: "bun test", memo: false },
        { id: "done", type: "end" },
      ],
    };
    const result = validateGraph(g);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("rejects a start without a next edge", () => {
    const g = baseGraph({ nodes: [{ id: "start", type: "start" as const }, { id: "e", type: "end" }] });
    const result = validateGraph(g);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "nodes.start" && i.message.includes("next"))).toBe(true);
  });
});

describe("graph helpers", () => {
  test("collectEdges returns every explicit edge", () => {
    const g = baseGraph();
    const edges = collectEdges(g);
    expect(edges).toContainEqual({ from: "start", to: "build" });
    expect(edges).toContainEqual({ from: "retry", to: "done" });
    expect(edges).toContainEqual({ from: "retry", to: "fail" });
  });

  test("findNode locates a node by id", () => {
    const g = baseGraph();
    const node = findNode(g, "build");
    expect(node?.type).toBe("step");
    expect(findNode(g, "missing")).toBeUndefined();
  });

  test("reachableNodes computes the reachable set from start", () => {
    const g = baseGraph();
    const reachable = reachableNodes(g);
    expect(reachable.sort()).toEqual(["build", "done", "fail", "retry", "start"].sort());
  });

  test("findCycles reports explicit cycles", () => {
    const g: WorkflowGraph = {
      name: "cyc",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "a" },
        { id: "a", type: "step", prompt: "a", next: "b" },
        { id: "b", type: "step", prompt: "b", next: "a" },
        { id: "e", type: "end" },
      ],
    };
    const cycles = findCycles(g);
    expect(cycles.length).toBeGreaterThan(0);
  });

  test("findCycles returns none for a while-loop graph (loop lives in the condition)", () => {
    const g: WorkflowGraph = {
      name: "ok",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "w" },
        { id: "w", type: "while", condition: "i < 2", body: ["s"], maxIterations: 2, next: "e" },
        { id: "s", type: "step", prompt: "work" },
        { id: "e", type: "end" },
      ],
    };
    expect(findCycles(g)).toEqual([]);
    expect(validateGraph(g).ok).toBe(true);
  });
});
