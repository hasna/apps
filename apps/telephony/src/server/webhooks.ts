import { handleInboundSms } from "../lib/sms.js";
import { handleInboundWhatsApp } from "../lib/whatsapp.js";
import { handleInboundCall } from "../lib/voice.js";
import { handleVoicemailRecording } from "../lib/voicemail.js";
import { copyProviderMedia as copyProviderMediaAction, mediaStorageFromConfig, type MediaStorage } from "../lib/media-storage.js";
import { getCallByTwilioSid, updateCallStatus } from "../db/calls.js";
import { dispatchWebhook } from "../lib/webhooks.js";

export function parseFormBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    if (key) params[key] = value;
  }
  return params;
}

export async function handleSmsWebhook(body: string): Promise<string> {
  const params = parseFormBody(body);
  const msg = await handleInboundSms({
    MessageSid: params.MessageSid || "",
    From: params.From || "",
    To: params.To || "",
    Body: params.Body || "",
    NumMedia: params.NumMedia,
    MediaUrl0: params.MediaUrl0,
  });

  await dispatchWebhook("sms.inbound", msg);

  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

export async function handleWhatsAppWebhook(body: string): Promise<string> {
  const params = parseFormBody(body);
  const msg = await handleInboundWhatsApp({
    MessageSid: params.MessageSid || "",
    From: params.From || "",
    To: params.To || "",
    Body: params.Body || "",
    NumMedia: params.NumMedia,
    MediaUrl0: params.MediaUrl0,
    MediaContentType0: params.MediaContentType0,
  });

  await dispatchWebhook("whatsapp.inbound", msg);

  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

export async function handleVoiceWebhook(body: string): Promise<string> {
  const params = parseFormBody(body);
  const call = await handleInboundCall({
    CallSid: params.CallSid || "",
    From: params.From || "",
    To: params.To || "",
    CallStatus: params.CallStatus || "",
    Direction: params.Direction || "",
  });

  await dispatchWebhook("call.inbound", call);

  // Default: play greeting and record voicemail
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>You've reached the AI assistant. Please leave a message after the beep.</Say>
  <Record maxLength="120" transcribe="true" action="/webhooks/voicemail/recording" />
</Response>`;
}

export async function handleVoicemailRecordingWebhook(body: string): Promise<string> {
  const params = parseFormBody(body);
  const voicemail = await handleVoicemailRecording({
    call_id: params.CallSid,
    from_number: params.From || "",
    to_number: params.To || "",
    recording_url: params.RecordingUrl || "",
    duration: parseInt(params.RecordingDuration || "0"),
  });

  await dispatchWebhook("voicemail.new", voicemail);

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you. Goodbye.</Say></Response>`;
}

export async function handleStatusWebhook(body: string, mediaStorage?: MediaStorage): Promise<string> {
  const params = parseFormBody(body);
  const storage = mediaStorage ?? mediaStorageFromConfig();

  // Message status update
  if (params.MessageSid && params.MessageStatus) {
    const statusMap: Record<string, string> = {
      queued: "queued", sent: "sent", delivered: "delivered", failed: "failed",
      undelivered: "failed", read: "read",
    };
    const status = statusMap[params.MessageStatus] || params.MessageStatus;
    // We'd need to look up by twilio_sid — simplified here
    await dispatchWebhook("message.status", { sid: params.MessageSid, status });
  }

  // Call status update
  if (params.CallSid && params.CallStatus) {
    await dispatchWebhook("call.status", { sid: params.CallSid, status: params.CallStatus });
  }

  // Call recording at completion: only the recording-completed status
  // callback (RecordingStatus=completed) carries the final, fully-written
  // media. Twilio fires intermediate recording status callbacks
  // (recording-started / recording-in-progress / recording-paused) that also
  // carry RecordingUrl while the recording is still being written; copying
  // those would persist partial bytes as authoritative on the call row, and
  // updateCallStatus can never clear an earlier object_key/sha256 — so gate
  // the copy on RecordingStatus=completed and ignore the intermediate events.
  // Soft-fail by design — a failed copy leaves the row with object_key null.
  if (params.CallSid && params.RecordingUrl && params.RecordingStatus === "completed") {
    const call = getCallByTwilioSid(params.CallSid);
    if (call) {
      let objectKey: string | undefined;
      let sha256: string | undefined;
      const copy = await copyProviderMediaAction(params.CallSid, params.RecordingUrl, undefined, storage);
      if (copy) {
        objectKey = copy.objectKey;
        sha256 = copy.sha256;
      }
      updateCallStatus(call.id, call.status, {
        recording_url: params.RecordingUrl,
        ...(objectKey ? { object_key: objectKey } : {}),
        ...(sha256 ? { sha256 } : {}),
      });
    } else if (storage.usesS3) {
      console.error(`[telephony] media copy: recording webhook for unknown CallSid ${params.CallSid}; skipping media copy`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}
