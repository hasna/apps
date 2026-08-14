import type { Hono } from "hono";
import { memberService } from "../../services/index.js";
import type { MemberKind, MemberStatus } from "../../types/index.js";
import type { AppVariables } from "../app.js";
import { listQueryResponse } from "../list-query.js";

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    return ((await c.req.json()) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export function registerMemberRoutes(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/members", (c) => {
    const url = new URL(c.req.url);
    const filter = {
      ...(url.searchParams.get("kind") ? { kind: url.searchParams.get("kind") as MemberKind } : {}),
      ...(url.searchParams.get("status") ? { status: url.searchParams.get("status") as MemberStatus } : {}),
      ...(url.searchParams.get("owner_id") ? { owner_id: url.searchParams.get("owner_id")! } : {}),
      ...(url.searchParams.get("entity_id") ? { entity_id: url.searchParams.get("entity_id")! } : {}),
    };
    const members = memberService.listMembers(filter, c.get("authCtx"));
    return c.json(listQueryResponse(url, members, { default_sort: "created_at", allowed_sorts: ["created_at", "name", "kind", "status", "role"] }));
  });

  app.get("/members/:id", (c) => c.json(memberService.getMember(c.req.param("id"), c.get("authCtx"))));

  app.post("/members", async (c) => {
    const b = await body(c);
    const member = memberService.createMember(
      {
        kind: b.kind as MemberKind,
        name: String(b.name ?? ""),
        home_entity_id: String(b.home_entity_id ?? ""),
        home_entity_slug: (b.home_entity_slug as string) ?? null,
        role: b.role as string | undefined,
        owner_id: (b.owner_id as string) ?? null,
        status: b.status as MemberStatus | undefined,
        email: (b.email as string) ?? null,
        effective_date: b.effective_date as string | undefined,
      },
      c.get("authCtx"),
    );
    return c.json(member, 201);
  });

  app.patch("/members/:id", async (c) => {
    const b = await body(c);
    const member = memberService.updateMember(
      c.req.param("id"),
      {
        name: b.name as string | undefined,
        role: b.role as string | undefined,
        home_entity_slug: b.home_entity_slug as string | undefined,
        email: b.email as string | undefined,
        owner_id: b.owner_id as string | undefined,
        expected_version: b.expected_version as number | undefined,
      },
      c.get("authCtx"),
    );
    return c.json(member);
  });
}
