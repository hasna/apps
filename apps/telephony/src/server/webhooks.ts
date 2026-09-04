import { handleInboundSms } from "../lib/sms.js";
import { handleInboundWhatsApp } from "../lib/whatsapp.js";
import { handleInboundCall } from "../lib/voice.js";
import { handleVoicemailRecording } from "../lib/voicemail.js";
import { copyProviderMedia as copyProviderMediaAction, mediaStorageFromConfig, type MediaStorage } from "../lib/media-storage.js";
import { dispatchWebhook } from "../lib/webhooks.js";
import { getStore, type TelephonyStore } from "../lib/store/index.js";
import type { Call } from "../types/index.js";

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
    const store = getStore();
    const call = await store.getCallByTwilioSid(params.CallSid);
    if (call) {
      // Persist the provider recording URL on the call row first — that is
      // the durable fact of this webhook, and it must not wait on the media
      // copy. The copy then runs in the background (see media-storage.ts):
      // a call recording can be large, so fetching it + uploading it inline
      // would extend Twilio's synchronous callback window toward its timeout.
      // Row updates are idempotent and the copy key is content-addressed, so
      // a Twilio retry re-running either is benign. If the background copy
      // never completes (e.g. the process restarts mid-copy), the row keeps
      // the provider URL and object_key null — the documented soft-fail.
      await store.updateCallStatus(call.id, call.status, { recording_url: params.RecordingUrl });
      trackMediaCopy(copyCallRecordingMedia(store, call, params.RecordingUrl, storage));
    } else if (storage.usesS3) {
      console.error(`[telephony] media copy: recording webhook for unknown CallSid ${params.CallSid}; skipping media copy`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

/**
 * Copy a completed call recording into the media bucket and attach the
 * object_key/sha256 pointers to the call row. Never throws: the copy is
 * soft-fail (media-storage.ts) and a store attach failure is logged, so a
 * background failure cannot crash the webhook server or surface as an
 * unhandled rejection.
 */
async function copyCallRecordingMedia(store: TelephonyStore, call: Call, recordingUrl: string, storage: MediaStorage): Promise<void> {
  try {
    const copy = await copyProviderMediaAction(call.twilio_sid ?? call.id, recordingUrl, undefined, storage);
    if (copy) {
      await store.updateCallStatus(call.id, call.status, { object_key: copy.objectKey, sha256: copy.sha256 });
    }
  } catch (error) {
    console.error(
      `[telephony] media copy: attaching object_key/sha256 failed for call ${call.id}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

// Background media copies, tracked so tests (and shutdown) can await them.
// The status webhook responds once the durable row update is done; these
// continue after the response is on the wire.
const inflightMediaCopies = new Set<Promise<void>>();

function trackMediaCopy(copy: Promise<void>): void {
  inflightMediaCopies.add(copy);
  copy.then(
    () => inflightMediaCopies.delete(copy),
    () => inflightMediaCopies.delete(copy),
  );
}

/** Test hook: resolve when every tracked background media copy has settled. */
export async function flushBackgroundMediaCopies(): Promise<void> {
  while (inflightMediaCopies.size > 0) {
    await Promise.allSettled([...inflightMediaCopies]);
  }
}
