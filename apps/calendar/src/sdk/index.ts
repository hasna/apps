/**
 * @hasna/calendar SDK — the typed `/v1` client, generated from the serve
 * OpenAPI document (src/server/openapi.ts). Import as `@hasna/calendar/sdk`.
 *
 * Self-hosted usage (client mode = CALENDAR_API_URL + CALENDAR_API_KEY, never a DSN):
 *
 *   import { CalendarV1Client } from "@hasna/calendar/sdk";
 *   const client = new CalendarV1Client({
 *     baseUrl: process.env.CALENDAR_API_URL!,
 *     apiKey: process.env.CALENDAR_API_KEY!,
 *   });
 *   const { orgs } = await client.listOrgs();
 */
export * from "./v1.generated.js";
export { CalendarV1Client as CalendarClient } from "./v1.generated.js";

/** Build a client straight from CALENDAR_API_URL + CALENDAR_API_KEY. */
import { CalendarV1Client } from "./v1.generated.js";
export function createCalendarClient(env: NodeJS.ProcessEnv = process.env): CalendarV1Client {
  const baseUrl = env.CALENDAR_API_URL;
  if (!baseUrl) throw new Error("CALENDAR_API_URL is required to build the calendar SDK client");
  return new CalendarV1Client({ baseUrl, apiKey: env.CALENDAR_API_KEY });
}
