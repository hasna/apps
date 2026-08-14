// DAG Compiler — resolve depends → topological execution order

import type { OmpCard, OmpDAG, OmpExecutionPlan, OmpExecutionStep } from "../types/index.js";

/**
 * Build a DAG from cards and their depends fields.
 * Returns the DAG with topologically-sorted parallel execution groups.
 */
export function buildDAG(cards: OmpCard[]): OmpDAG {
  const nodes = new Map<string, OmpCard>();
  const edges = new Map<string, string[]>(); // id → [dependency IDs]

  for (const card of cards) {
    nodes.set(card.id, card);
    edges.set(card.id, card.depends.filter((d) => d !== card.id));
  }

  const order = topologicalSort(nodes, edges);

  return { nodes, edges, order };
}

/**
 * Topological sort with parallel group detection.
 * Returns an array of groups — each group contains card IDs
 * that can be executed in parallel (no mutual dependencies).
 *
 * Uses Kahn's algorithm.
 */
function topologicalSort(
  nodes: Map<string, OmpCard>,
  edges: Map<string, string[]>
): string[][] {
  // Build in-degree map
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dependency → cards that depend on it

  for (const id of nodes.keys()) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }

  for (const [id, deps] of edges) {
    let validDeps = 0;
    for (const dep of deps) {
      if (nodes.has(dep)) {
        dependents.get(dep)!.push(id);
        validDeps++;
      }
      // Missing deps are silently ignored (validator catches these)
    }
    inDegree.set(id, validDeps);
  }

  // Kahn's algorithm with level tracking
  const groups: string[][] = [];
  let queue = [...nodes.keys()].filter((id) => inDegree.get(id) === 0);

  const visited = new Set<string>();

  while (queue.length > 0) {
    // All nodes in the current queue can run in parallel
    groups.push([...queue]);

    const nextQueue: string[] = [];

    for (const id of queue) {
      visited.add(id);

      for (const dependent of dependents.get(id) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);

        if (newDegree === 0 && !visited.has(dependent)) {
          nextQueue.push(dependent);
        }
      }
    }

    queue = nextQueue;
  }

  // Check for cycles: if not all nodes visited, there's a cycle
  if (visited.size < nodes.size) {
    const cycleNodes = [...nodes.keys()].filter((id) => !visited.has(id));
    throw new DAGCycleError(cycleNodes);
  }

  return groups;
}

/**
 * Compile a DAG into an execution plan with descriptions.
 */
export function compileExecutionPlan(dag: OmpDAG): OmpExecutionPlan {
  const steps: OmpExecutionStep[] = dag.order.map((group, i) => ({
    parallel: group,
    description: `Step ${i + 1}: ${group.join(", ")}${group.length > 1 ? " (parallel)" : ""}`,
  }));

  return {
    steps,
    totalCards: dag.nodes.size,
  };
}

/**
 * Get all cards that have no dependencies (entry points).
 */
export function getEntryPoints(dag: OmpDAG): string[] {
  return dag.order.length > 0 ? dag.order[0] : [];
}

/**
 * Get all cards that nothing depends on (leaf nodes).
 */
export function getLeafNodes(dag: OmpDAG): string[] {
  const hasDependents = new Set<string>();
  for (const deps of dag.edges.values()) {
    for (const dep of deps) {
      hasDependents.add(dep);
    }
  }
  // Actually, we need reverse: nodes that ARE dependencies vs those that aren't
  const isDependedOn = new Set<string>();
  for (const [id, deps] of dag.edges) {
    // This card depends on deps — deps are depended on
    for (const dep of deps) {
      isDependedOn.add(dep);
    }
  }
  // Leaf = nothing depends on it (it's not in isDependedOn as a target... wait, reverse)
  // Leaf = no other card lists this card in its depends
  const depTargets = new Set<string>();
  for (const deps of dag.edges.values()) {
    for (const dep of deps) depTargets.add(dep);
  }
  return [...dag.nodes.keys()].filter((id) => !depTargets.has(id));
}

export class DAGCycleError extends Error {
  cycleNodes: string[];

  constructor(cycleNodes: string[]) {
    super(`Dependency cycle detected involving: ${cycleNodes.join(", ")}`);
    this.name = "DAGCycleError";
    this.cycleNodes = cycleNodes;
  }
}
