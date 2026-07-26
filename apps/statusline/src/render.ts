import type { Segment, SegmentColor, StatusContext } from "./providers/types.js";
import type { StatuslineConfig } from "./config.js";
import { getSegment } from "./segments/index.js";

const ANSI: Record<SegmentColor, string> = {
  cyan: "\u001b[36m",
  magenta: "\u001b[35m",
  blue: "\u001b[34m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
};
const RESET = "\u001b[0m";

/** Honour the `NO_COLOR` convention regardless of what the config asks for. */
function colorsEnabled(cfg: StatuslineConfig, env = process.env): boolean {
  if (env.NO_COLOR) return false;
  return cfg.colors !== false;
}

function paint(segment: Segment, text: string, ctx: StatusContext): string {
  const color = typeof segment.color === "function" ? segment.color(ctx) : segment.color;
  const code = color ? ANSI[color] : undefined;
  return code ? `${code}${text}${RESET}` : text;
}

/** Render the configured segments; a failing segment is dropped, never fatal. */
export async function renderLine(ctx: StatusContext, cfg: StatuslineConfig): Promise<string> {
  const colorize = colorsEnabled(cfg);
  const parts: string[] = [];
  for (const id of cfg.segments) {
    const segment = getSegment(id);
    if (!segment) continue;
    try {
      const out = await segment.render(ctx);
      if (out) parts.push(colorize ? paint(segment, out, ctx) : out);
    } catch {
      // statuslines must never break the host UI
    }
  }
  return parts.join(cfg.separator);
}
