import { getStore } from "./store/index.js";
import { generateSpeech } from "./tts.js";
import { transcribeUrl } from "./stt.js";
import { saveAudio, generateAudioFilename, getAudioDir } from "./audio.js";
import { MediaStorage, mediaStorageFromConfig } from "./media-storage.js";
import { copyProviderMedia as copyProviderMediaAction } from "./media-storage.js";
import type { Voicemail } from "../types/index.js";
import { join } from "node:path";

export async function setGreeting(options: {
  agent_id: string;
  text: string;
  voice_id?: string;
}): Promise<{ path: string }> {
  const filename = `greeting-${options.agent_id}.mp3`;
  const result = await generateSpeech({
    text: options.text,
    voice_id: options.voice_id,
    output_path: filename,
  });
  return { path: result.path };
}

export function getGreetingPath(agentId: string): string | null {
  const path = join(getAudioDir(), `greeting-${agentId}.mp3`);
  try {
    const { existsSync } = require("node:fs");
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

export async function handleVoicemailRecording(options: {
  call_id?: string;
  from_number: string;
  to_number: string;
  recording_url: string;
  duration?: number;
  agent_id?: string;
  project_id?: string;
  /** Injectable media storage (tests); defaults to the env-config bucket. */
  mediaStorage?: MediaStorage;
}): Promise<Voicemail> {
  // Download recording locally (best effort, as before)
  let localPath: string | undefined;
  try {
    const res = await fetch(options.recording_url);
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const filename = generateAudioFilename("voicemail");
      localPath = saveAudio(buffer, filename);
    }
  } catch {}

  // Transcribe
  let transcription: string | undefined;
  try {
    const result = await transcribeUrl(options.recording_url);
    transcription = result.text;
  } catch {}

  const store = getStore();

  // Create the voicemail row FIRST — the voicemail is the durable fact of
  // this webhook and its row must never wait on a media copy. The provider
  // recording URL is on the row from the start; the bucket copy attaches to
  // the same row afterwards. Soft-fail by design: a failed copy leaves the
  // row with object_key null and the provider URL as the fallback — media
  // copy is a retention improvement, not a reason to drop a voicemail, and a
  // failed insert can never orphan an uploaded object.
  const voicemail = await store.createVoicemail({
    call_id: options.call_id,
    from_number: options.from_number,
    to_number: options.to_number,
    recording_url: options.recording_url,
    local_path: localPath,
    transcription,
    duration: options.duration,
    agent_id: options.agent_id,
    project_id: options.project_id,
  });

  if (!options.recording_url) return voicemail;
  if (!options.call_id) {
    // Bucket configured but the webhook carried no call id — nothing to key
    // the object under. Logged, not fatal: the row keeps the provider URL.
    if ((options.mediaStorage ?? mediaStorageFromConfig()).usesS3) {
      console.error(`[telephony] media copy: voicemail webhook without a call_id; skipping media copy`);
    }
    return voicemail;
  }
  // Copy the provider recording into the bucket and attach the copy metadata
  // to the just-created row (media-storage.ts soft-fail contract). Keyed
  // under the call the recording belongs to, mirroring the call row.
  const copy = await copyProviderMediaAction(options.call_id, options.recording_url, undefined, options.mediaStorage ?? mediaStorageFromConfig());
  if (copy) {
    await store.updateVoicemailMedia(voicemail.id, { object_key: copy.objectKey, sha256: copy.sha256 });
    return { ...voicemail, object_key: copy.objectKey, sha256: copy.sha256 };
  }
  return voicemail;
}
