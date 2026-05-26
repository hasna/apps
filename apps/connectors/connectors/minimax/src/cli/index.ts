#!/usr/bin/env bun
import { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import { Minimax } from '../api';
import {
  getApiKey,
  setApiKey,
  getGroupId,
  setGroupId,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
} from '../utils/config';
import { success, error, info, print } from '../utils/output';
import type { OutputFormat } from '../utils/output';

const CONNECTOR_NAME = 'connect-minimax';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Minimax API connector - Video, music, image, TTS, and sound effects')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist.`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) process.env.MINIMAX_API_KEY = opts.apiKey;
  });

function getFormat(cmd: Command): OutputFormat {
  return (cmd.parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Minimax {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set MINIMAX_API_KEY.`);
    process.exit(1);
  }
  const groupId = getGroupId();
  return new Minimax({ apiKey, groupId });
}

// Config
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <key>').description('Set API key').action((key) => {
  setApiKey(key);
  success('API key saved');
});

configCmd.command('set-group <id>').description('Set group ID').action((id) => {
  setGroupId(id);
  success('Group ID saved');
});

configCmd.command('show').description('Show current config').action(() => {
  const key = getApiKey();
  const group = getGroupId();
  info(`Profile: ${getCurrentProfile()}`);
  info(`API Key: ${key ? key.substring(0, 6) + '...' : 'not set'}`);
  info(`Group ID: ${group || 'not set'}`);
  info(`Config dir: ${getConfigDir()}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Profile
const profileCmd = program.command('profile').description('Manage profiles');
profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) { info('No profiles'); return; }
  profiles.forEach(p => console.log(p === current ? `* ${p}` : `  ${p}`));
});
profileCmd.command('create <name>').description('Create profile').action((name) => {
  createProfile(name) ? success(`Profile "${name}" created`) : error(`Profile "${name}" already exists`);
});
profileCmd.command('use <name>').description('Switch profile').action((name) => {
  setCurrentProfile(name);
  success(`Switched to profile "${name}"`);
});
profileCmd.command('delete <name>').description('Delete profile').action((name) => {
  deleteProfile(name) ? success(`Profile "${name}" deleted`) : error(`Cannot delete "${name}"`);
});

// Video
const videoCmd = program.command('video').description('Video generation');
videoCmd
  .command('generate <prompt>')
  .description('Generate a video from a text prompt')
  .option('-m, --model <model>', 'Model (T2V-01, I2V-01)', 'T2V-01')
  .option('-o, --output <path>', 'Save video to file')
  .option('--image <url>', 'First frame image (switches to I2V)')
  .option('--no-optimize', 'Disable prompt optimizer')
  .action(async (prompt, opts, cmd) => {
    const client = getClient();
    info('Starting video generation...');
    try {
      const result = await client.video.generateAndWait(prompt, {
        model: opts.model,
        firstFrameImage: opts.image,
        promptOptimizer: opts.optimize !== false,
      });
      if (opts.output) {
        const buffer = await client.video.download(result.fileId);
        await writeFile(resolve(opts.output), buffer);
        success(`Video saved to: ${opts.output}`);
      } else {
        print(result, getFormat(cmd));
      }
    } catch (e: any) { error(e.message); process.exit(1); }
  });

// Music
const musicCmd = program.command('music').description('Music generation');
musicCmd
  .command('generate <prompt>')
  .description('Generate music from a prompt')
  .option('-o, --output <path>', 'Save audio to file')
  .option('--lyrics <text>', 'Lyrics for the song')
  .option('--genre <genre>', 'Music genre')
  .option('--mood <mood>', 'Desired mood')
  .option('--tempo <bpm>', 'Tempo in BPM', parseInt)
  .option('--duration <seconds>', 'Duration in seconds', parseInt)
  .action(async (prompt, opts, cmd) => {
    const client = getClient();
    info('Starting music generation...');
    try {
      const result = await client.music.generateAndWait(prompt, {
        lyrics: opts.lyrics,
        genre: opts.genre,
        mood: opts.mood,
        tempo: opts.tempo,
        duration: opts.duration,
      });
      if (opts.output) {
        const buffer = await client.music.download(result.audioUrl);
        await writeFile(resolve(opts.output), buffer);
        success(`Music saved to: ${opts.output}`);
      } else {
        print(result, getFormat(cmd));
      }
    } catch (e: any) { error(e.message); process.exit(1); }
  });

// TTS
const ttsCmd = program.command('tts').description('Text-to-speech');
ttsCmd
  .command('generate <text>')
  .description('Generate speech from text')
  .option('-o, --output <path>', 'Save audio to file (required)')
  .option('-m, --model <model>', 'Model', 'speech-02-hd')
  .option('--voice <id>', 'Voice ID')
  .option('--speed <n>', 'Speed (0.5-2.0)', parseFloat)
  .option('--format <fmt>', 'Audio format (mp3, wav, flac)', 'mp3')
  .option('--language <code>', 'Language boost code')
  .action(async (text, opts, cmd) => {
    const client = getClient();
    if (!opts.output) { error('--output is required'); process.exit(1); }
    info('Generating speech...');
    try {
      const buffer = await client.tts.generateToBuffer(text, {
        model: opts.model,
        voiceId: opts.voice,
        speed: opts.speed,
        format: opts.format,
        languageBoost: opts.language,
      });
      await writeFile(resolve(opts.output), buffer);
      success(`Audio saved to: ${opts.output}`);
    } catch (e: any) { error(e.message); process.exit(1); }
  });

// Image
const imageCmd = program.command('image').description('Image generation');
imageCmd
  .command('generate <prompt>')
  .description('Generate an image from a prompt')
  .option('-o, --output <path>', 'Save image to file')
  .option('--aspect <ratio>', 'Aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4)', '1:1')
  .option('-n, --count <n>', 'Number of images', parseInt, 1)
  .action(async (prompt, opts, cmd) => {
    const client = getClient();
    info('Starting image generation...');
    try {
      const result = await client.image.generateAndWait(prompt, {
        aspectRatio: opts.aspect,
        n: opts.count,
      });
      if (opts.output) {
        const buffer = await client.image.download(result.fileId);
        await writeFile(resolve(opts.output), buffer);
        success(`Image saved to: ${opts.output}`);
      } else {
        print(result, getFormat(cmd));
      }
    } catch (e: any) { error(e.message); process.exit(1); }
  });

// Sound Effects
const sfxCmd = program.command('sfx').description('Sound effects generation');
sfxCmd
  .command('generate <prompt>')
  .description('Generate a sound effect from a prompt')
  .option('-o, --output <path>', 'Save audio to file')
  .option('--duration <seconds>', 'Duration in seconds', parseInt)
  .action(async (prompt, opts, cmd) => {
    const client = getClient();
    info('Generating sound effect...');
    try {
      const result = await client.soundEffects.generateAndWait(prompt, {
        duration: opts.duration,
      });
      if (opts.output) {
        const buffer = await client.soundEffects.download(result.audioUrl);
        await writeFile(resolve(opts.output), buffer);
        success(`Sound effect saved to: ${opts.output}`);
      } else {
        print(result, getFormat(cmd));
      }
    } catch (e: any) { error(e.message); process.exit(1); }
  });

program.parse();
