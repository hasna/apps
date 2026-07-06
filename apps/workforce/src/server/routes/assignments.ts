import type { Hono } from "hono";
import { assignmentService } from "../../services/index.js";
import type { AppVariables } from "../app.js";
import { listQueryResponse } from "../list-query.js";

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    return ((await c.req.json()) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export function registerAssignmentRoutes(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/assignments", (c) => {
    const url = new URL(c.req.url);
    const filter = {
      ...(url.searchParams.get("member_id") ? { member_id: url.searchParams.get("member_id")! } : {}),
      ...(url.searchParams.get("entity_id") ? { entity_id: url.searchParams.get("entity_id")! } : {}),
      ...(url.searchParams.get("status") ? { status: url.searchParams.get("status")! } : {}),
    };
    const rows = assignmentService.listAssignments(filter, c.get("authCtx"));
    return c.json(listQueryResponse(url, rows, { default_sort: "created_at", allowed_sorts: ["created_at", "start_date", "allocation_pct", "status"] }));
  });

  app.get("/assignments/:id", (c) => c.json(assignmentService.getAssignment(c.req.param("id"), c.get("authCtx"))));

  app.post("/assignments", async (c) => {
    const b = await body(c);
    const assignment = assignmentService.createAssignment(
      {
        member_id: String(b.member_id ?? ""),
        entity_id: String(b.entity_id ?? ""),
        project: (b.project as string) ?? null,
        role_on_assignment: b.role_on_assignment as string | undefined,
        allocation_pct: b.allocation_pct as number | undefined,
        start_date: b.start_date as string | undefined,
        end_date: (b.end_date as string) ?? null,
      },
      c.get("authCtx"),
    );
    return c.json(assignment, 201);
  });

  app.post("/assignments/:id/end", async (c) => {
    const b = await body(c);
    return c.json(assignmentService.endAssignment(c.req.param("id"), { end_date: b.end_date as string | undefined }, c.get("authCtx")));
  });
}
