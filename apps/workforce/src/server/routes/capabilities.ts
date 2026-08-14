import type { Hono } from "hono";
import { capabilityService } from "../../services/index.js";
import type { CapabilityLevel } from "../../types/index.js";
import type { AppVariables } from "../app.js";

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    return ((await c.req.json()) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export function registerCapabilityRoutes(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/members/:id/capabilities", (c) => c.json(capabilityService.listCapabilities(c.req.param("id"), c.get("authCtx"))));

  app.post("/members/:id/capabilities", async (c) => {
    const b = await body(c);
    const cap = capabilityService.addCapability(
      {
        member_id: c.req.param("id"),
        name: String(b.name ?? ""),
        category: b.category as string | undefined,
        level: b.level as CapabilityLevel | undefined,
        notes: (b.notes as string) ?? null,
      },
      c.get("authCtx"),
    );
    return c.json(cap, 201);
  });

  app.delete("/capabilities/:id", (c) => c.json(capabilityService.removeCapability(c.req.param("id"), c.get("authCtx"))));
}
