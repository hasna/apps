import { RecordingsSDKError } from "./transport.js";

export function textOption(options: object, allowed: readonly string[]): boolean {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      Object.keys(options).some(key => !allowed.includes(key))) throw new RecordingsSDKError("invalid_input");
  const value = (options as { includeText?: unknown }).includeText;
  if (value !== undefined && typeof value !== "boolean") throw new RecordingsSDKError("invalid_input");
  return value === true;
}
