import * as local from "./send.sqlite.js";
import * as remote from "./send.api.js";
import { isApiClientConfigured } from "../store-resolution.js";

export type * from "./send.sqlite.js";

function routed<K extends keyof typeof local>(key: K): typeof local[K] {
  return ((...args: unknown[]) => {
    const implementation = (isApiClientConfigured() ? remote : local) as Record<string, unknown>;
    const candidate = implementation[String(key)];
    if (typeof candidate !== "function") throw new Error(`send.${String(key)} is unavailable in the selected mode.`);
    return (candidate as (...values: unknown[]) => unknown)(...args);
  }) as typeof local[K];
}

export const getAttachmentDecodedSize = routed("getAttachmentDecodedSize");
export const validateSendAttachments = routed("validateSendAttachments");
export const assertWarmingLimit = routed("assertWarmingLimit");
export const assertDomainOutboundReady = routed("assertDomainOutboundReady");
export const sendWithFailover = routed("sendWithFailover");
export const MAX_ATTACHMENT_SIZE_BYTES = local.MAX_ATTACHMENT_SIZE_BYTES;
export const MAX_ATTACHMENT_COUNT = local.MAX_ATTACHMENT_COUNT;
