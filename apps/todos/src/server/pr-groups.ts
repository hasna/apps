import { PrGroupLedger } from "../pr-groups/ledger.js";
import {
  PrGroupLedgerError,
  type AdmitPrGroupInput,
  type AppendPrGroupEventInput,
  type RecoverPrGroupInput,
} from "../pr-groups/types.js";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorStatus(error: PrGroupLedgerError): number {
  switch (error.code) {
    case "PR_GROUP_INVALID_INPUT":
    case "PR_GROUP_EXACT_HEAD_REQUIRED":
      return 400;
    case "PR_GROUP_NOT_FOUND":
      return 404;
    case "PR_GROUP_ATOMICITY_UNAVAILABLE":
    case "PR_GROUP_REMOTE_UNAVAILABLE":
      return 503;
    default:
      return 409;
  }
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export interface PrGroupRequestPrincipal {
  actor_id?: string | null;
  actor_run_id?: string | null;
}

export async function handlePrGroupHttpRequest(
  req: Request,
  url: URL,
  ledger: PrGroupLedger,
  basePath: "/api/pr-groups" | "/v1/pr-groups",
  principal?: PrGroupRequestPrincipal,
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== basePath && !path.startsWith(`${basePath}/`)) return null;
  const relative = path.slice(basePath.length).split("/").filter(Boolean);
  const groupId = relative[0];
  const action = relative[1];
  const method = req.method.toUpperCase();

  try {
    if (!groupId && method === "POST" && action === undefined) {
      return json({ error: "unknown PR-group route", code: "PR_GROUP_NOT_FOUND" }, 404);
    }
    if (groupId === "admit" && !action) {
      if (method !== "POST") return json({ error: "method not allowed" }, 405);
      const body = await readJson(req);
      if (!body) return json({ error: "invalid JSON body", code: "PR_GROUP_INVALID_INPUT" }, 400);
      return json(await ledger.admit(body as unknown as AdmitPrGroupInput), 201);
    }
    if (!groupId) return json({ error: "PR group id is required", code: "PR_GROUP_INVALID_INPUT" }, 400);
    if (!action && method === "GET") {
      return json({ view: await ledger.get(groupId) });
    }
    if (action === "events") {
      if (method === "GET") {
        const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
        const afterSequence = url.searchParams.has("after_sequence")
          ? Number(url.searchParams.get("after_sequence"))
          : undefined;
        return json({
          history: await ledger.events(groupId, {
            ...(limit !== undefined ? { limit } : {}),
            ...(afterSequence !== undefined ? { after_sequence: afterSequence } : {}),
          }),
        });
      }
      if (method === "POST") {
        const body = await readJson(req);
        if (!body) return json({ error: "invalid JSON body", code: "PR_GROUP_INVALID_INPUT" }, 400);
        return json(await ledger.append({
          ...body,
          group_id: groupId,
          authenticated_actor_id: principal?.actor_id ?? undefined,
          authenticated_actor_run_id: principal?.actor_run_id ?? undefined,
        } as unknown as AppendPrGroupEventInput), 201);
      }
      return json({ error: "method not allowed" }, 405);
    }
    if (action === "recover") {
      if (method !== "POST") return json({ error: "method not allowed" }, 405);
      const body = await readJson(req);
      if (!body) return json({ error: "invalid JSON body", code: "PR_GROUP_INVALID_INPUT" }, 400);
      return json(await ledger.recover({
        ...body,
        group_id: groupId,
      } as unknown as RecoverPrGroupInput), 201);
    }
    return json({ error: "unknown PR-group route", code: "PR_GROUP_NOT_FOUND" }, 404);
  } catch (cause) {
    if (cause instanceof PrGroupLedgerError) {
      return json({
        error: cause.message,
        code: cause.code,
        details: cause.details,
        authoritative: true,
      }, errorStatus(cause));
    }
    return json({
      error: cause instanceof Error ? cause.message : "internal PR-group error",
      code: "PR_GROUP_ATOMICITY_UNAVAILABLE",
    }, 500);
  }
}
