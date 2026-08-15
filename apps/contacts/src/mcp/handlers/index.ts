import type { ToolHandler } from "./types.js";
import { coreHandlers } from "./core.js";
import { crmHandlers } from "./crm.js";
import { advancedHandlers } from "./advanced.js";
import { audienceHandlers } from "./audience.js";

export type { ToolHandler } from "./types.js";

export const allHandlers: Record<string, ToolHandler> = {
  ...coreHandlers,
  ...crmHandlers,
  ...advancedHandlers,
  ...audienceHandlers,
};
