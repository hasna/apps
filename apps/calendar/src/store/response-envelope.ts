export class CalendarResponseError extends Error {}
/** Validate the operation's /v1 envelope before any client unwraps it. */
export function validateResponseEnvelope(method: string, path: string, body: unknown): void {
  const [resource, id, action] = path.replace(/^\/v1(?=\/)/, "").split("/").filter(Boolean);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CalendarResponseError("Calendar API returned an invalid response envelope.");
  const names: Record<string, [string, string]> = { orgs: ["orgs", "org"], agents: ["agents", "agent"], calendars: ["calendars", "calendar"], events: ["events", "event"], attendees: ["attendees", "attendee"], availability: ["availability", "availability"], members: ["members", "member"] };
  const pair = names[resource ?? ""];
  if (!pair) throw new CalendarResponseError("Calendar API returned an unknown response operation.");
  const collection = method === "GET" && (!id || resource === "availability" || id === "search" || id === "conflicts");
  const key = method === "DELETE" ? "deleted" : id === "conflicts" ? "conflicts" : pair[collection ? 0 : 1];
  const value = (body as Record<string, unknown>)[key];
  const entity = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v) && typeof (v as { id?: unknown }).id === "string" && (v as { id: string }).id.length > 0;
  if (key === "deleted" ? typeof value !== "boolean" : collection ? !Array.isArray(value) || !value.every(entity) : !entity(value)) throw new CalendarResponseError("Calendar API returned an invalid response envelope.");
  if (resource === "events" && id && !["search", "conflicts"].includes(id) && method === "GET" && !action) {
    const attendees = (body as Record<string, unknown>).attendees;
    if (!Array.isArray(attendees) || !attendees.every(entity)) throw new CalendarResponseError("Calendar API returned an invalid response envelope.");
  }
}
