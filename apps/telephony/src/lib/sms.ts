import { getTwilioClient, getDefaultPhoneNumber } from "./twilio.js";
import { getStore } from "./store/index.js";
import { MediaStorage, copyProviderMedia as copyProviderMediaAction, mediaStorageFromConfig } from "./media-storage.js";
import type { Message } from "../types/index.js";

export async function sendSms(options: {
  to: string;
  body: string;
  from?: string;
  agent_id?: string;
  project_id?: string;
  status_callback?: string;
}): Promise<Message> {
  const store = getStore();
  const client = getTwilioClient();
  const from = options.from || getDefaultPhoneNumber();

  // Record the outbound message through the Store first (local or cloud).
  const msg = await store.createMessage({
    type: "sms_outbound",
    from_number: from,
    to_number: options.to,
    body: options.body,
    status: "queued",
    agent_id: options.agent_id,
    project_id: options.project_id,
  });

  try {
    const params: Record<string, string> = {
      to: options.to,
      from,
      body: options.body,
    };
    if (options.status_callback) params.statusCallback = options.status_callback;

    const twilioMsg = await client.messages.create(params as any);

    await store.updateMessageStatus(msg.id, "sent");
    return { ...msg, status: "sent", twilio_sid: twilioMsg.sid };
  } catch (err: any) {
    await store.updateMessageStatus(msg.id, "failed", err.message);
    return { ...msg, status: "failed", error_message: err.message };
  }
}

export interface InboundSmsPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  MediaUrl0?: string;
}

export async function handleInboundSms(payload: InboundSmsPayload, agentId?: string, projectId?: string, mediaStorage?: MediaStorage): Promise<Message> {
  // Copy inbound MMS media into the bucket before the row is created (see
  // media-storage.ts for the soft-fail contract). Keyed under the provider
  // message sid, which the row records as twilio_sid.
  let objectKey: string | undefined;
  let sha256: string | undefined;
  if (payload.MediaUrl0) {
    if (payload.MessageSid) {
      const copy = await copyProviderMediaAction(payload.MessageSid, payload.MediaUrl0, undefined, mediaStorage ?? mediaStorageFromConfig());
      if (copy) {
        objectKey = copy.objectKey;
        sha256 = copy.sha256;
      }
    } else if ((mediaStorage ?? mediaStorageFromConfig()).usesS3) {
      console.error(`[telephony] media copy: inbound SMS without a MessageSid; skipping media copy`);
    }
  }

  return getStore().createMessage({
    type: "sms_inbound",
    from_number: payload.From,
    to_number: payload.To,
    body: payload.Body,
    media_url: payload.MediaUrl0 || undefined,
    object_key: objectKey ?? null,
    sha256: sha256 ?? null,
    status: "received",
    agent_id: agentId,
    project_id: projectId,
    twilio_sid: payload.MessageSid,
  });
}
