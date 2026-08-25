/**
 * Graph rendering (the `workflows graph <file>` command) — deterministic
 * text, DOT, and JSON renderings of a workflow graph. Presentation only:
 * all graph semantics live in graph.ts; this module never mutates.
 */
import { collectEdges, type GraphNode, type WorkflowGraph } from "./graph.js";

function nodeLabel(node: GraphNode): string {
  switch (node.type) {
    case "start":
      return "start";
    case "end":
      return "end";
    case "step": {
      const work = node.prompt ? `prompt=${JSON.stringify(node.prompt.slice(0, 40))}` : `command=${JSON.stringify((node.command ?? "").slice(0, 60))}`;
      return `step ${work}${node.lane ? ` lane=${node.lane}` : ""}`;
    }
    case "decision":
      return `decision if ${node.condition}`;
    case "while":
      return `while ${node.condition} maxIterations=${node.maxIterations} body=[${node.body.join(", ")}]`;
  }
}

/** Deterministic text rendering: one line per node in graph order. */
export function renderGraphText(graph: WorkflowGraph): string {
  const lines: string[] = [];
  lines.push(`graph ${graph.name}@${graph.version} — ${graph.nodes.length} node(s)`);
  for (const node of graph.nodes) {
    switch (node.type) {
      case "start":
      case "step":
        lines.push(`  ${node.id} [${nodeLabel(node)}]${node.next ? ` -> ${node.next}` : ""}`);
        break;
      case "decision":
        lines.push(`  ${node.id} [${nodeLabel(node)}]${node.then ? ` then-> ${node.then}` : ""}${node.else ? ` else-> ${node.else}` : ""}`);
        break;
      case "while":
        lines.push(`  ${node.id} [${nodeLabel(node)}]${node.next ? ` -> ${node.next}` : ""}`);
        break;
      case "end":
        lines.push(`  ${node.id} [end]`);
        break;
    }
  }
  return lines.join("\n");
}

/** Graphviz DOT rendering (explicit edges solid, while-body edges dashed). */
export function renderGraphDot(graph: WorkflowGraph): string {
  const lines: string[] = [];
  lines.push(`digraph "${graph.name}" {`);
  lines.push(`  graph [label="${graph.name}@${graph.version}"];`);
  for (const node of graph.nodes) {
    const shape = node.type === "decision" ? "diamond" : node.type === "while" ? "doubleoctagon" : node.type === "end" ? "doublecircle" : "box";
    lines.push(`  "${node.id}" [shape=${shape}, label="${node.id}"];`);
  }
  for (const edge of collectEdges(graph)) {
    lines.push(`  "${edge.from}" -> "${edge.to}";`);
  }
  for (const node of graph.nodes) {
    if (node.type === "while") {
      for (const bodyId of node.body) {
        lines.push(`  "${node.id}" -> "${bodyId}" [style=dashed, label="body"];`);
      }
    }
  }
  lines.push("}");
  return lines.join("\n");
}

/** Machine-readable rendering: node registry + explicit edges + while bodies. */
export function renderGraphJson(graph: WorkflowGraph): Record<string, unknown> {
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    ...(node.type === "step" ? { lane: node.lane ?? "claude", hasPrompt: node.prompt !== undefined, hasCommand: node.command !== undefined } : {}),
    ...(node.type === "decision" ? { condition: node.condition } : {}),
    ...(node.type === "while" ? { condition: node.condition, maxIterations: node.maxIterations, body: node.body } : {}),
  }));
  return {
    name: graph.name,
    version: graph.version,
    nodes,
    edges: collectEdges(graph),
    whileBodies: graph.nodes.filter((n) => n.type === "while").map((n) => ({ id: n.id, body: n.body })),
  };
}
