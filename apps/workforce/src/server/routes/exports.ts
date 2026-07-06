import type { Hono } from "hono";
import { exportService } from "../../services/index.js";
import type { AppVariables } from "../app.js";

export function registerExportRoutes(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/exports/roster", (c) => {
    const url = new URL(c.req.url);
    const roster = exportService.exportRoster(
      {
        ...(url.searchParams.get("entity_id") ? { entity_id: url.searchParams.get("entity_id")! } : {}),
        include_offboarded: url.searchParams.get("include_offboarded") === "true",
      },
      c.get("authCtx"),
    );
    return c.json(roster);
  });
}
