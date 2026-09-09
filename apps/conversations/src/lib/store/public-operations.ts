import { getStore } from "./index.js";
import type { ProjectChannelCollectionRequest, ProjectChannelMessageCollectionRequest } from "../project-channel-registration.js";
import type { RedactMessagesOptions } from "../admin-redaction.js";

/** Shared API convenience functions; none can select or create local state. */
export async function listProjectChannelRegistrationPage(request: ProjectChannelCollectionRequest) {
  return getStore().listProjectChannelRegistrationPage(request);
}
export async function listProjectChannelMessagePage(request: ProjectChannelMessageCollectionRequest) {
  return getStore().listProjectChannelMessagePage(request);
}
export async function redactMessagesById(options: RedactMessagesOptions) {
  return getStore().redactMessages(options);
}
