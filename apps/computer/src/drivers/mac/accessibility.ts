import { resolveMacHelper } from "./helpers.js";
import { formatMacProcessFailure, runMacProcess } from "./process.js";

/** A UI element from the accessibility tree */
export interface AXElement {
  role: string | null;
  title: string | null;
  value: string | null;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
  focused: boolean;
  children: number;
}

/**
 * Query the accessibility tree for a given app (or the frontmost app).
 * Returns structured UI elements with roles, titles, positions, and sizes.
 * Requires Accessibility permissions in System Settings.
 */
export async function queryAccessibilityTree(opts?: {
  /** App name to query (default: frontmost app) */
  app?: string;
  /** Only get the focused element's subtree */
  focusedOnly?: boolean;
  /** Max tree depth (default: 3) */
  depth?: number;
}): Promise<AXElement[]> {
  const helperPath = getAccessibilityHelperPath();
  const args = [helperPath];

  if (opts?.app) {
    args.push("--app", opts.app);
  }
  if (opts?.focusedOnly) {
    args.push("--focused");
  }
  if (opts?.depth !== undefined) {
    args.push("--depth", String(opts.depth));
  }

  const result = await runMacProcess(args);
  if (result.exitCode !== 0) {
    throw new Error(`accessibility query failed: ${formatMacProcessFailure(args, result)}`);
  }

  try {
    return JSON.parse(result.stdout) as AXElement[];
  } catch {
    return [];
  }
}

/**
 * Build a text summary of the accessibility tree for the AI model.
 * Includes clickable elements with positions for precise targeting.
 */
export function summarizeAccessibilityTree(elements: AXElement[]): string {
  if (elements.length === 0) return "No accessibility information available.";

  const lines: string[] = ["UI Elements:"];
  for (const el of elements) {
    const parts: string[] = [];
    if (el.role) parts.push(el.role);
    if (el.title) parts.push(`"${el.title}"`);
    if (el.label) parts.push(`(${el.label})`);
    if (el.value) parts.push(`value="${el.value}"`);

    const pos = `at (${el.x + Math.round(el.width / 2)}, ${el.y + Math.round(el.height / 2)})`;
    const size = `${el.width}x${el.height}`;
    const flags: string[] = [];
    if (!el.enabled) flags.push("disabled");
    if (el.focused) flags.push("focused");

    lines.push(
      `  - ${parts.join(" ")} ${pos} [${size}]${flags.length ? ` (${flags.join(", ")})` : ""}`
    );
  }
  return lines.join("\n");
}

/** Resolve path to the compiled Swift accessibility helper binary */
let _helperPath: string | null = null;
function getAccessibilityHelperPath(): string {
  if (_helperPath) return _helperPath;
  _helperPath = resolveMacHelper("accessibility");
  return _helperPath;
}
