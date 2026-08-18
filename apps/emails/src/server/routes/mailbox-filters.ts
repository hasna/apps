import {
  applyMailboxFilter,
  createMailboxFilter,
  deleteMailboxFilter,
  getMailboxFilter,
  listMailboxFilters,
  updateMailboxFilter,
} from "../../db/mailbox-filters.sqlite.js";
import type { MailboxFilterInput } from "../../lib/mailbox-filters.js";
import { MailboxFilterInputError } from "../../lib/mailbox-filters.js";
import { badRequest, internalError, json, parseBody, queryPage } from "./helpers.js";

// A JSON primitive body must fail with 400 invalid_input, matching the
// self-hosted server's readJsonBody object gate — `field in body` on a string
// or number would otherwise TypeError into a 500 (PUT) or a silent no-op
// (PATCH).
async function parseObjectBody(req: Request): Promise<Record<string, unknown>> {
  const body = await parseBody(req);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new MailboxFilterInputError("request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

function filterError(error: unknown): Response {
  const code = (error as { code?: unknown })?.code;
  if (code === "invalid_input") {
    return json({ error: error instanceof Error ? error.message : "invalid filter", code }, 400);
  }
  if (code === "conflict") return json({ error: error instanceof Error ? error.message : "filter already exists" }, 409);
  if (code === "not_found") return json({ error: error instanceof Error ? error.message : "filter not found" }, 404);
  return internalError(error);
}

export async function handle(req: Request, url: URL, path: string, method: string): Promise<Response | null> {
  if (!path.startsWith("/api/mailbox-filters")) return null;
  try {
    const suffix = path.slice("/api/mailbox-filters".length);
    if (suffix === "" || suffix === "/") {
      if (method === "GET") return json({ items: listMailboxFilters(queryPage(url, 100, 1000)) });
      if (method === "POST") return json(createMailboxFilter(await parseObjectBody(req) as unknown as MailboxFilterInput), 201);
      return json({ error: "method not allowed" }, 405);
    }
    const applyMatch = suffix.match(/^\/([^/]+)\/apply$/);
    if (applyMatch) {
      if (method !== "POST") return json({ error: "method not allowed" }, 405);
      const filter = getMailboxFilter(decodeURIComponent(applyMatch[1]!));
      if (!filter) return json({ error: "mailbox filter not found", code: "not_found" }, 404);
      return json(applyMailboxFilter(filter, queryPage(url, 100, 1000)));
    }
    const identifier = decodeURIComponent(suffix.slice(1));
    if (!identifier) return badRequest("filter id or name is required");
    if (method === "GET") {
      const filter = getMailboxFilter(identifier);
      return filter ? json(filter) : json({ error: "mailbox filter not found", code: "not_found" }, 404);
    }
    if (method === "PATCH") return json(updateMailboxFilter(identifier, await parseObjectBody(req) as Partial<MailboxFilterInput>));
    if (method === "PUT") {
      const body = await parseObjectBody(req) as Partial<MailboxFilterInput>;
      const putFields = ["name", "mailbox", "criteria"] as const;
      if (!putFields.every((field) => field in body)) {
        return json({ error: "PUT requires name, mailbox, and criteria", code: "invalid_input" }, 400);
      }
      return json(updateMailboxFilter(identifier, body, { replaceCriteria: true }));
    }
    if (method === "DELETE") {
      const filter = getMailboxFilter(identifier);
      if (!filter) return json({ error: "mailbox filter not found", code: "not_found" }, 404);
      deleteMailboxFilter(filter.id);
      return json({ deleted: true, id: identifier });
    }
    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    return filterError(error);
  }
}
