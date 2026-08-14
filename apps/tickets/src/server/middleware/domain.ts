import type { Context, MiddlewareHandler } from "hono";
import { getDomainByName } from "../../db/domains.ts";
import { getProjectBySlug } from "../../db/projects.ts";
import type { Project } from "../../types/index.ts";

/**
 * Domain routing middleware.
 * Reads the Host header, looks up the domain in the domains table,
 * and attaches the resolved project to the request context.
 * Falls back gracefully — API requests without a matching domain still work.
 */
export const domainMiddleware: MiddlewareHandler = async (c: Context, next) => {
  const host = c.req.header("Host") ?? c.req.header("host") ?? "";
  const hostname = host.split(":")[0]!; // strip port

  // Skip localhost and IP addresses
  if (!hostname || hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return next();
  }

  const domain = getDomainByName(hostname);
  if (domain?.verified && domain.project_id) {
    try {
      const { getProjectById } = await import("../../db/projects.ts");
      const project = getProjectById(domain.project_id);
      c.set("domainProject", project);
    } catch {
      // Project not found — ignore, fallback to normal routing
    }
  }

  return next();
};

/** Get the project resolved from the domain (if any) */
export function getDomainProject(c: Context): Project | undefined {
  return c.get("domainProject") as Project | undefined;
}
