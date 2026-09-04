import { getTwilioClient, getDefaultPhoneNumber } from "./twilio.js";
import { getStore } from "./store/index.js";
import { MediaStorage, copyProviderMedia as copyProviderMediaAction, mediaStorageFromConfig } from "./media-storage.js";
import type { Message } from "../types/index.js";

function whatsappNumber(number: string): string {
  if (number.startsWith("whatsapp:")) return number;
  return `whatsapp:${number}`;
}

export async function sendWhatsApp(options: {
  to: string;
  body: string;
  from?: string;
  agent_id?: string;
  project_id?: string;
}): Promise<Message> {
  const store = getStore();
  const client = getTwilioClient();
  const from = whatsappNumber(options.from || getDefaultPhoneNumber());
  const to = whatsappNumber(options.to);

  const msg = await store.createMessage({
    type: "whatsapp_outbound",
    from_number: from,
    to_number: to,
    body: options.body,
    status: "queued",
    agent_id: options.agent_id,
    project_id: options.project_id,
  });

  try {
    const twilioMsg = await client.messages.create({ to, from, body: options.body });
    await store.updateMessageStatus(msg.id, "sent");
    return { ...msg, status: "sent", twilio_sid: twilioMsg.sid };
  } catch (err: any) {
    await store.updateMessageStatus(msg.id, "failed", err.message);
    return { ...msg, status: "failed", error_message: err.message };
  }
}

export async function sendWhatsAppAudio(options: {
  to: string;
  media_url: string;
  body?: string;
  from?: string;
  agent_id?: string;
  project_id?: string;
}): Promise<Message> {
  const store = getStore();
  const client = getTwilioClient();
  const from = whatsappNumber(options.from || getDefaultPhoneNumber());
  const to = whatsappNumber(options.to);

  const msg = await store.createMessage({
    type: "whatsapp_outbound",
    from_number: from,
    to_number: to,
    body: options.body || "",
    media_url: options.media_url,
    status: "queued",
    agent_id: options.agent_id,
    project_id: options.project_id,
  });

  try {
    const twilioMsg = await client.messages.create({
      to,
      from,
      body: options.body || "",
      mediaUrl: [options.media_url],
    });
    await store.updateMessageStatus(msg.id, "sent");
    return { ...msg, status: "sent", twilio_sid: twilioMsg.sid };
  } catch (err: any) {
    await store.updateMessageStatus(msg.id, "failed", err.message);
    return { ...msg, status: "failed", error_message: err.message };
  }
}

export interface InboundWhatsAppPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
}

export async function handleInboundWhatsApp(payload: InboundWhatsAppPayload, agentId?: string, projectId?: string, mediaStorage?: MediaStorage): Promise<Message> {
  // Copy inbound WhatsApp media into the bucket before the row is created (see
  // media-storage.ts for the soft-fail contract). Keyed under the provider
  // message sid, which the row records as twilio_sid.
  let objectKey: string | undefined;
  let sha256: string | undefined;
  if (payload.MediaUrl0) {
    if (payload.MessageSid) {
      const copy = await copyProviderMediaAction(payload.MessageSid, payload.MediaUrl0, payload.MediaContentType0, mediaStorage ?? mediaStorageFromConfig());
      if (copy) {
        objectKey = copy.objectKey;
        sha256 = copy.sha256;
      }
    } else if ((mediaStorage ?? mediaStorageFromConfig()).usesS3) {
      console.error(`[telephony] media copy: inbound WhatsApp without a MessageSid; skipping media copy`);
    }
  }

  return getStore().createMessage({
    type: "whatsapp_inbound",
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
