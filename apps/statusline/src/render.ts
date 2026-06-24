import type { StatusContext } from "./providers/types.js";
import type { StatuslineConfig } from "./config.js";
import { getSegment } from "./segments/index.js";

/** Render the configured segments; a failing segment is dropped, never fatal. */
export async function renderLine(ctx: StatusContext, cfg: StatuslineConfig): Promise<string> {
  const parts: string[] = [];
  for (const id of cfg.segments) {
    const segment = getSegment(id);
    if (!segment) continue;
    try {
      const out = await segment.render(ctx);
      if (out) parts.push(out);
    } catch {
      // statuslines must never break the host UI
    }
  }
  return parts.join(cfg.separator);
}
