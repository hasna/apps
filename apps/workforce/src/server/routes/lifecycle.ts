import type { Hono } from "hono";
import { lifecycleService } from "../../services/index.js";
import type { AppVariables } from "../app.js";

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    return ((await c.req.json()) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export function registerLifecycleRoutes(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/members/:id/lifecycle", (c) => c.json(lifecycleService.listMemberLifecycle(c.req.param("id"), c.get("authCtx"))));

  app.post("/members/:id/role-change", async (c) => {
    const b = await body(c);
    return c.json(
      lifecycleService.recordRoleChange(
        { member_id: c.req.param("id"), to_role: String(b.to_role ?? ""), effective_date: b.effective_date as string | undefined, reason: b.reason as string | undefined },
        c.get("authCtx"),
      ),
    );
  });

  app.post("/members/:id/suspend", async (c) => {
    const b = await body(c);
    return c.json(lifecycleService.suspendMember({ member_id: c.req.param("id"), effective_date: b.effective_date as string | undefined, reason: b.reason as string | undefined }, c.get("authCtx")));
  });

  app.post("/members/:id/reactivate", async (c) => {
    const b = await body(c);
    return c.json(lifecycleService.reactivateMember({ member_id: c.req.param("id"), effective_date: b.effective_date as string | undefined, reason: b.reason as string | undefined }, c.get("authCtx")));
  });

  app.post("/members/:id/offboard", async (c) => {
    const b = await body(c);
    return c.json(lifecycleService.offboardMember({ member_id: c.req.param("id"), effective_date: b.effective_date as string | undefined, reason: b.reason as string | undefined }, c.get("authCtx")));
  });

  app.get("/lifecycle/verify", (c) => c.json(lifecycleService.verifyLifecycleAudit(c.get("authCtx"))));
}
