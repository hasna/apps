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
  // Copy the provider media into the bucket BEFORE the row is created, so a
  // voicemail row born after this change either already points at an object
  // in the bucket (object_key + sha256) or explains its absence in the logs.
  // Soft-fail by design: a failed copy leaves the row with the provider URL
  // and object_key null; media copy is a retention improvement, not a reason
  // to drop a voicemail.
  let objectKey: string | undefined;
  let sha256: string | undefined;
  const storage = options.mediaStorage ?? mediaStorageFromConfig();
  if (options.recording_url) {
    if (options.call_id) {
      const copy = await copyProviderMediaAction(options.call_id, options.recording_url, undefined, storage);
      if (copy) {
        objectKey = copy.objectKey;
        sha256 = copy.sha256;
      }
    } else if (storage.usesS3) {
      // Bucket configured but the webhook carried no call id — nothing to key
      // the object under. Logged, not fatal: the row keeps the provider URL.
      console.error(`[telephony] media copy: voicemail webhook without a call_id; skipping media copy`);
    }
  }

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

  return getStore().createVoicemail({
    call_id: options.call_id,
    from_number: options.from_number,
    to_number: options.to_number,
    recording_url: options.recording_url,
    object_key: objectKey ?? null,
    sha256: sha256 ?? null,
    local_path: localPath,
    transcription,
    duration: options.duration,
    agent_id: options.agent_id,
    project_id: options.project_id,
  });
}
