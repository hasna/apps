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
  const store = getStore();
  const storage = mediaStorage ?? mediaStorageFromConfig();

  // Create the message row FIRST — the inbound message is the durable fact of
  // this webhook and its row must never wait on a media copy. The provider
  // media URL is recorded on the row from the start; the bucket copy attaches
  // to the same row afterwards (media-storage.ts soft-fail contract: a failed
  // copy leaves object_key null and the row playable from the provider URL).
  const message = await store.createMessage({
    type: "whatsapp_inbound",
    from_number: payload.From,
    to_number: payload.To,
    body: payload.Body,
    media_url: payload.MediaUrl0 || undefined,
    status: "received",
    agent_id: agentId,
    project_id: projectId,
    twilio_sid: payload.MessageSid,
  });

  if (!payload.MediaUrl0) return message;
  if (!payload.MessageSid) {
    if (storage.usesS3) console.error(`[telephony] media copy: inbound WhatsApp without a MessageSid; skipping media copy`);
    return message;
  }
  // Copy inbound WhatsApp media into the bucket (see media-storage.ts). Keyed
  // under the provider message sid, which the row records as twilio_sid, then
  // attached to the row. Copy runs after the row write, so a failed insert
  // can never orphan an uploaded object.
  const copy = await copyProviderMediaAction(payload.MessageSid, payload.MediaUrl0, payload.MediaContentType0, storage);
  if (copy) {
    await store.updateMessageMedia(message.id, { object_key: copy.objectKey, sha256: copy.sha256 });
    return { ...message, object_key: copy.objectKey, sha256: copy.sha256 };
  }
  return message;
}
