/**
 * The graph language v1 — the core of @hasna/workflows.
 *
 * A workflow is a directed acyclic graph of nodes. The only looping construct
 * is the `while` node (owner amendment 2026-08-25): its repetition lives in
 * the condition, never in an explicit back-edge, so the explicit-edge graph
 * stays acyclic and validate() can reject cycles structurally.
 *
 * Node types:
 *   start     — exactly one entry node; carries `next`.
 *   step      — a unit of work executed by a lane (claude|codex|cursor|grok)
 *               or a shell command; carries `next`.
 *   decision  — boolean condition; carries `then` / `else` edges.
 *   while     — loop-while-true over a body of step/decision nodes, with a
 *               REQUIRED finite maxIterations bound (SOL finite-budget rule);
 *               carries `next` (exit edge).
 *   end       — terminal; no edges.
 */
import { ExprSyntaxError, parseExpr } from "./expr.js";

export const GRAPH_NODE_TYPES = ["start", "step", "decision", "while", "end"] as const;
export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export const LANE_KINDS = ["claude", "codex", "cursor", "grok"] as const;
export type LaneKind = (typeof LANE_KINDS)[number];

export interface StartNode {
  id: string;
  type: "start";
  next?: string;
}

export interface StepNode {
  id: string;
  type: "step";
  /** Lane that executes the work. Default "claude". */
  lane?: LaneKind;
  /** Prompt handed to the lane agent. Required unless `command` is set. */
  prompt?: string;
  /** Shell command alternative to a lane prompt. */
  command?: string;
  next?: string;
  /** Retries on lane failure. Default 0. */
  maxRetries?: number;
  /** Memoize the node output by input hash across runs. Default false. */
  memo?: boolean;
  /** Per-invocation timeout budget in ms. Default 120000. */
  timeoutMs?: number;
}

export interface DecisionNode {
  id: string;
  type: "decision";
  /** Boolean expression over the run context (see expr.ts). */
  condition: string;
  then?: string;
  else?: string;
}

export interface WhileNode {
  id: string;
  type: "while";
  /** Loop-while-true; `i` is the loop counter in the condition scope. */
  condition: string;
  /** Node ids executed per iteration; steps/decisions only in v1. */
  body: string[];
  /** REQUIRED finite loop bound (SOL finite-budget rule). */
  maxIterations: number;
  /** Exit edge taken once the condition fails or the bound is reached. */
  next?: string;
}

export interface EndNode {
  id: string;
  type: "end";
}

export type GraphNode = StartNode | StepNode | DecisionNode | WhileNode | EndNode;

export interface WorkflowGraph {
  name: string;
  version: string;
  nodes: GraphNode[];
  /**
   * Optional files/globs (relative to the data dir, or absolute) whose
   * fingerprint (mtime + sha256) joins every memoized node's input.
   * A memoized command that reads external state MUST declare it here, or
   * it can serve a stale cached value that contradicts a live run.
   */
  memoWatch?: string[];
}

export interface GraphIssue {
  /** Dotted path to the offending member, e.g. "nodes.build" or "nodes.w.body". */
  path: string;
  message: string;
}

export interface GraphValidation {
  ok: boolean;
  issues: GraphIssue[];
}

const NODE_ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function issue(issues: GraphIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

export function findNode(graph: WorkflowGraph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

export interface Edge {
  from: string;
  to: string;
}

/** Every explicit edge in the graph (next/then/else). While-body edges are
 * internal and validated separately; the while's repetition is expressed by
 * its condition, not by an edge. */
export function collectEdges(graph: WorkflowGraph): Edge[] {
  const edges: Edge[] = [];
  for (const node of graph.nodes) {
    switch (node.type) {
      case "start":
      case "step":
        if (node.next) edges.push({ from: node.id, to: node.next });
        break;
      case "decision":
        if (node.then) edges.push({ from: node.id, to: node.then });
        if (node.else) edges.push({ from: node.id, to: node.else });
        break;
      case "while":
        if (node.next) edges.push({ from: node.id, to: node.next });
        break;
      case "end":
        break;
    }
  }
  return edges;
}

/** Nodes reachable from the (unique) start node over explicit edges. */
export function reachableNodes(graph: WorkflowGraph): string[] {
  const start = graph.nodes.find((n) => n.type === "start");
  if (!start) return [];
  const seen = new Set<string>();
  const stack = [start.id];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = findNode(graph, id);
    if (!node) continue;
    if (node.type === "start" || node.type === "step") {
      if (node.next) stack.push(node.next);
    } else if (node.type === "decision") {
      if (node.then) stack.push(node.then);
      if (node.else) stack.push(node.else);
    } else if (node.type === "while") {
      // body nodes execute at runtime: the while node runs them per iteration
      for (const bodyId of node.body) stack.push(bodyId);
      if (node.next) stack.push(node.next);
    }
  }
  return [...seen];
}

/** Explicit cycles via depth-first search with white/grey/black coloring. */
export function findCycles(graph: WorkflowGraph): string[][] {
  const edges = collectEdges(graph);
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const color = new Map<string, "grey" | "black">();
  const stack: string[] = [];
  const cycles: string[][] = [];

  function visit(id: string): void {
    color.set(id, "grey");
    stack.push(id);
    for (const to of adj.get(id) ?? []) {
      const c = color.get(to);
      if (c === "grey") {
        const idx = stack.indexOf(to);
        cycles.push([...stack.slice(idx), to]);
      } else if (c === undefined) {
        visit(to);
      }
    }
    stack.pop();
    color.set(id, "black");
  }

  for (const node of graph.nodes) {
    if (color.get(node.id) === undefined) visit(node.id);
  }
  return cycles;
}

/** Validate a graph. Every rule has a named, checkable failure. */
export function validateGraph(graph: WorkflowGraph): GraphValidation {
  const issues: GraphIssue[] = [];

  if (typeof graph.name !== "string" || graph.name.trim() === "") {
    issue(issues, "name", "graph requires a non-empty name");
  }
  if (typeof graph.version !== "string" || graph.version.trim() === "") {
    issue(issues, "version", "graph requires a version string");
  }
  if (graph.memoWatch !== undefined) {
    if (!Array.isArray(graph.memoWatch) || graph.memoWatch.length === 0) {
      issue(issues, "memoWatch", "memoWatch must be a non-empty array of file paths or globs");
    } else {
      for (const entry of graph.memoWatch) {
        if (typeof entry !== "string" || entry.trim() === "") {
          issue(issues, "memoWatch", "each memoWatch entry must be a non-empty path or glob string");
          break;
        }
      }
    }
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    issue(issues, "nodes", "graph requires at least one node");
    return { ok: false, issues };
  }

  const starts = graph.nodes.filter((n) => n.type === "start");
  if (starts.length === 0) issue(issues, "nodes", "graph requires exactly one start node (found none)");
  if (starts.length > 1) issue(issues, "nodes", "graph requires exactly one start node (found multiple)");

  const ends = graph.nodes.filter((n) => n.type === "end");
  if (ends.length === 0) issue(issues, "nodes", "graph requires at least one end node");

  const seenIds = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (typeof node.id !== "string" || !NODE_ID_RE.test(node.id)) {
      issue(issues, "nodes", `node id ${JSON.stringify(node.id)} must match ${String(NODE_ID_RE)}`);
      continue;
    }
    if (seenIds.has(node.id)) {
      issue(issues, `nodes.${node.id}`, `duplicate node id ${node.id}`);
      continue;
    }
    seenIds.set(node.id, node);
    if (!GRAPH_NODE_TYPES.includes(node.type)) {
      issue(issues, `nodes.${node.id}`, `unknown node type ${JSON.stringify(node.type)}`);
      continue;
    }
    validateNode(graph, node, issues);
  }

  // structural checks that need the full id set
  for (const node of graph.nodes) {
    const edges = nodeEdges(node);
    for (const { kind, target } of edges) {
      if (!seenIds.has(target)) {
        issue(issues, `nodes.${node.id}`, `${kind} edge targets nonexistent node ${target}`);
      }
    }
  }

  // reachability (explicit edges only; while repetition is not an edge)
  if (starts.length === 1) {
    const reachable = new Set(reachableNodes(graph));
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        issue(issues, `nodes.${node.id}`, `node ${node.id} is unreachable from start`);
      }
    }
  }

  const cycles = findCycles(graph);
  for (const cycle of cycles) {
    issue(issues, "nodes", `explicit cycle detected: ${cycle.join(" -> ")} (loop only via a while node)`);
  }

  return { ok: issues.length === 0, issues };
}

interface OutEdge {
  kind: "next" | "then" | "else";
  target: string;
}

function nodeEdges(node: GraphNode): OutEdge[] {
  switch (node.type) {
    case "start":
    case "step":
      return node.next ? [{ kind: "next", target: node.next }] : [];
    case "decision":
      return [
        ...(node.then ? [{ kind: "then" as const, target: node.then }] : []),
        ...(node.else ? [{ kind: "else" as const, target: node.else }] : []),
      ];
    case "while":
      return node.next ? [{ kind: "next", target: node.next }] : [];
    case "end":
      return [];
  }
}

function validateNode(graph: WorkflowGraph, node: GraphNode, issues: GraphIssue[]): void {
  switch (node.type) {
    case "start":
      if (!node.next) issue(issues, `nodes.${node.id}`, "start node requires a next edge");
      break;
    case "step": {
      if (!node.prompt && !node.command) {
        issue(issues, `nodes.${node.id}`, "step node requires prompt or command");
      }
      if (node.lane !== undefined && !LANE_KINDS.includes(node.lane)) {
        issue(issues, `nodes.${node.id}`, `unknown lane ${JSON.stringify(node.lane)} (expected one of ${LANE_KINDS.join(", ")})`);
      }
      if (node.maxRetries !== undefined && (!Number.isInteger(node.maxRetries) || node.maxRetries < 0)) {
        issue(issues, `nodes.${node.id}`, "maxRetries must be a non-negative integer");
      }
      if (node.timeoutMs !== undefined && (!Number.isInteger(node.timeoutMs) || node.timeoutMs < 1)) {
        issue(issues, `nodes.${node.id}`, "timeoutMs must be a positive integer");
      }
      break;
    }
    case "decision": {
      if (typeof node.condition !== "string" || node.condition.trim() === "") {
        issue(issues, `nodes.${node.id}`, "decision node requires a condition expression");
      } else {
        try {
          parseExpr(node.condition);
        } catch (err) {
          if (err instanceof ExprSyntaxError) {
            issue(issues, `nodes.${node.id}.condition`, `invalid condition expression: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
      if (!node.then && !node.else) {
        issue(issues, `nodes.${node.id}`, "decision node requires then and/or else edge");
      }
      break;
    }
    case "while": {
      if (typeof node.condition !== "string" || node.condition.trim() === "") {
        issue(issues, `nodes.${node.id}`, "while node requires a condition expression");
      } else {
        try {
          parseExpr(node.condition);
        } catch (err) {
          if (err instanceof ExprSyntaxError) {
            issue(issues, `nodes.${node.id}.condition`, `invalid condition expression: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
      if (node.maxIterations === undefined) {
        issue(issues, `nodes.${node.id}`, "while node requires maxIterations (finite loop bound)");
      } else if (!Number.isInteger(node.maxIterations) || node.maxIterations < 1) {
        issue(issues, `nodes.${node.id}`, "maxIterations must be a positive integer");
      }
      if (!Array.isArray(node.body) || node.body.length === 0) {
        issue(issues, `nodes.${node.id}`, "while node requires a non-empty body");
      } else {
        for (const bodyId of node.body) {
          const bodyNode = findNode(graph, bodyId);
          if (!bodyNode) {
            issue(issues, `nodes.${node.id}`, `while body references nonexistent node ${bodyId}`);
            continue;
          }
          if (bodyNode.type === "start" || bodyNode.type === "end" || bodyNode.type === "while") {
            issue(issues, `nodes.${node.id}`, `while body may only contain step/decision nodes in v1 (found ${bodyNode.type})`);
          }
        }
        // body edges must stay inside the body (iteration-local flow)
        const bodySet = new Set(node.body);
        for (const bodyId of node.body) {
          const bodyNode = findNode(graph, bodyId);
          if (!bodyNode) continue;
          for (const { kind, target } of nodeEdges(bodyNode)) {
            if (!bodySet.has(target)) {
              issue(issues, `nodes.${node.id}`, `while body node ${bodyId} ${kind}-edge leaves the body (target ${target})`);
            }
          }
        }
      }
      break;
    }
    case "end":
      break;
  }
}
