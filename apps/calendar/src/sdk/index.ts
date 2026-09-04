/** Calendar SDK: authenticated HTTPS domain operations with generated envelopes. */
export * from "./v1.generated.js";
export { CalendarV1Client as CalendarClient } from "./v1.generated.js";
import { CalendarV1Client } from "./v1.generated.js";
export function createCalendarClient(env: NodeJS.ProcessEnv = process.env): CalendarV1Client {
  return new CalendarV1Client({ env });
}
