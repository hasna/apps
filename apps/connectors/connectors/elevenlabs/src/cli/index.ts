#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { ElevenLabs } from '../api';
import {
  getApiKey,
  setApiKey,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
  getDefaultVoiceId,
  setDefaultVoiceId,
  getDefaultModel,
  setDefaultModel,
  getOutputDir,
  setOutputDir,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';
import type { TTSModelId, AudioFormat } from '../types';

const CONNECTOR_NAME = 'connect-elevenlabs';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('ElevenLabs API connector CLI - Text-to-speech, voice cloning, sound effects, and more')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.ELEVENLABS_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ElevenLabs {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ELEVENLABS_API_KEY environment variable.`);
    process.exit(1);
  }
  return new ElevenLabs({ apiKey });
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getOutputPath(filename: string, format: string = 'mp3'): string {
  const outputDir = getOutputDir();
  ensureDir(outputDir);
  const ext = extname(filename) || `.${format}`;
  const base = basename(filename, ext);
  return join(outputDir, `${base}${ext}`);
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      info('No profiles found. Use "profile create <name>" to create one.');
      return;
    }

    success(`Profiles:`);
    profiles.forEach(p => {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
    });
    success(`Profile "${name}" created`);

    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (name === 'default') {
      error('Cannot delete the default profile');
      process.exit(1);
    }
    if (deleteProfile(name)) {
      success(`Profile "${name}" deleted`);
    } else {
      error(`Profile "${name}" not found`);
      process.exit(1);
    }
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Default Voice: ${config.defaultVoiceId || chalk.gray('not set')}`);
    info(`Default Model: ${config.defaultModel || chalk.gray('not set')}`);
    info(`Output Dir: ${config.outputDir || chalk.gray('current directory')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-voice <voiceId>')
  .description('Set default voice ID')
  .action((voiceId: string) => {
    setDefaultVoiceId(voiceId);
    success(`Default voice set to: ${voiceId}`);
  });

configCmd
  .command('set-model <modelId>')
  .description('Set default TTS model')
  .action((modelId: string) => {
    setDefaultModel(modelId);
    success(`Default model set to: ${modelId}`);
  });

configCmd
  .command('set-output <dir>')
  .description('Set default output directory')
  .action((dir: string) => {
    setOutputDir(dir);
    success(`Output directory set to: ${dir}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const voiceId = getDefaultVoiceId();
    const modelId = getDefaultModel();
    const outputDir = getOutputDir();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Default Voice: ${voiceId || chalk.gray('not set')}`);
    info(`Default Model: ${modelId || chalk.gray('eleven_multilingual_v2')}`);
    info(`Output Dir: ${outputDir}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Voices Commands
// ============================================
const voicesCmd = program
  .command('voices')
  .alias('voice')
  .description('Manage voices');

voicesCmd
  .command('list')
  .description('List all voices')
  .option('-n, --max <number>', 'Maximum results', '50')
  .option('--category <category>', 'Filter by category (premade, cloned, generated, professional)')
  .option('-s, --search <query>', 'Search voices')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.voices.list({
        pageSize: parseInt(opts.max),
        category: opts.category,
        search: opts.search,
      });

      if (getFormat(voicesCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold(`Voices (${result.voices.length}):\n`));
        for (const voice of result.voices) {
          const labels = voice.labels ? Object.values(voice.labels).join(', ') : '';
          console.log(`  ${chalk.cyan(voice.voice_id)} - ${chalk.bold(voice.name)}`);
          if (voice.category) console.log(`    Category: ${voice.category}`);
          if (labels) console.log(`    Labels: ${labels}`);
          if (voice.description) console.log(`    ${chalk.gray(voice.description.substring(0, 80))}...`);
          console.log();
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voicesCmd
  .command('get <voiceId>')
  .description('Get a voice by ID')
  .action(async (voiceId: string) => {
    try {
      const client = getClient();
      const result = await client.voices.get(voiceId);
      print(result, getFormat(voicesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voicesCmd
  .command('settings <voiceId>')
  .description('Get voice settings')
  .action(async (voiceId: string) => {
    try {
      const client = getClient();
      const result = await client.voices.getSettings(voiceId);
      print(result, getFormat(voicesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voicesCmd
  .command('delete <voiceId>')
  .description('Delete a voice')
  .action(async (voiceId: string) => {
    try {
      const client = getClient();
      await client.voices.delete(voiceId);
      success(`Voice ${voiceId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voicesCmd
  .command('preview <voiceId>')
  .description('Play voice preview (opens URL)')
  .action(async (voiceId: string) => {
    try {
      const client = getClient();
      const voice = await client.voices.get(voiceId);
      if (voice.preview_url) {
        info(`Preview URL: ${voice.preview_url}`);
        // Try to open in browser
        const open = await import('open').then(m => m.default).catch(() => null);
        if (open) {
          await open(voice.preview_url);
        }
      } else {
        warn('No preview available for this voice');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// TTS Commands
// ============================================
const ttsCmd = program
  .command('tts')
  .alias('speak')
  .description('Text-to-speech commands');

ttsCmd
  .command('convert <text>')
  .description('Convert text to speech')
  .option('-v, --voice <voiceId>', 'Voice ID')
  .option('-m, --model <modelId>', 'Model ID (eleven_v3, eleven_multilingual_v2, eleven_flash_v2_5, etc.)')
  .option('-o, --output <file>', 'Output file path')
  .option('--format <format>', 'Audio format (mp3_44100_128, pcm_44100, etc.)', 'mp3_44100_128')
  .option('--stability <value>', 'Voice stability (0-1)', '0.5')
  .option('--similarity <value>', 'Similarity boost (0-1)', '0.75')
  .option('--style <value>', 'Style exaggeration (0-1)', '0')
  .option('--speed <value>', 'Speech speed (0.25-4.0)', '1.0')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const voiceId = opts.voice || getDefaultVoiceId();

      if (!voiceId) {
        error('Voice ID required. Use --voice or set default with "config set-voice"');
        process.exit(1);
      }

      info(`Generating speech with voice ${voiceId}...`);

      const audio = await client.tts.convert(voiceId, text, {
        modelId: (opts.model || getDefaultModel() || 'eleven_multilingual_v2') as TTSModelId,
        outputFormat: opts.format as AudioFormat,
        voiceSettings: {
          stability: parseFloat(opts.stability),
          similarity_boost: parseFloat(opts.similarity),
          style: parseFloat(opts.style),
          speed: parseFloat(opts.speed),
        },
      });

      const outputPath = opts.output || getOutputPath(`tts_${Date.now()}`, 'mp3');
      writeFileSync(outputPath, Buffer.from(audio));
      success(`Audio saved to: ${outputPath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ttsCmd
  .command('stream <text>')
  .description('Stream text to speech (lower latency)')
  .option('-v, --voice <voiceId>', 'Voice ID')
  .option('-m, --model <modelId>', 'Model ID')
  .option('-o, --output <file>', 'Output file path')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const voiceId = opts.voice || getDefaultVoiceId();

      if (!voiceId) {
        error('Voice ID required. Use --voice or set default with "config set-voice"');
        process.exit(1);
      }

      info(`Streaming speech...`);

      const audio = await client.tts.stream(voiceId, text, {
        modelId: (opts.model || getDefaultModel() || 'eleven_flash_v2_5') as TTSModelId,
      });

      const outputPath = opts.output || getOutputPath(`tts_stream_${Date.now()}`, 'mp3');
      writeFileSync(outputPath, Buffer.from(audio));
      success(`Audio saved to: ${outputPath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ttsCmd
  .command('models')
  .description('List available TTS models')
  .action(() => {
    const client = getClient();
    const models = client.tts.getAvailableModels();

    console.log(chalk.bold('Available TTS Models:\n'));
    for (const model of models) {
      console.log(`  ${chalk.cyan(model.id)}`);
      console.log(`    ${model.name}`);
      console.log(`    ${chalk.gray(model.description)}`);
      console.log();
    }
  });

// ============================================
// STT Commands
// ============================================
const sttCmd = program
  .command('stt')
  .alias('transcribe')
  .description('Speech-to-text commands');

sttCmd
  .command('convert <audioFile>')
  .description('Transcribe audio file to text')
  .option('-m, --model <modelId>', 'Model ID (scribe_v2, scribe_v2_realtime)', 'scribe_v2')
  .option('-l, --language <code>', 'Language code (e.g., en, es, fr)')
  .option('--diarize', 'Enable speaker diarization')
  .option('--speakers <num>', 'Number of speakers (for diarization)')
  .action(async (audioFile: string, opts) => {
    try {
      const client = getClient();

      if (!existsSync(audioFile)) {
        error(`File not found: ${audioFile}`);
        process.exit(1);
      }

      info(`Transcribing ${audioFile}...`);

      const fileBuffer = readFileSync(audioFile);
      const blob = new Blob([fileBuffer]);

      const result = await client.stt.transcribe(blob, {
        modelId: opts.model,
        languageCode: opts.language,
        diarize: opts.diarize,
        numSpeakers: opts.speakers ? parseInt(opts.speakers) : undefined,
      });

      if (getFormat(sttCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold('Transcription:\n'));
        console.log(result.text);
        if (result.language_code) {
          console.log(chalk.gray(`\nDetected language: ${result.language_code}`));
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sttCmd
  .command('models')
  .description('List available STT models')
  .action(() => {
    const client = getClient();
    const models = client.stt.getAvailableModels();

    console.log(chalk.bold('Available STT Models:\n'));
    for (const model of models) {
      console.log(`  ${chalk.cyan(model.id)}`);
      console.log(`    ${model.name}`);
      console.log(`    ${chalk.gray(model.description)}`);
      console.log();
    }
  });

// ============================================
// Sound Effects Commands
// ============================================
const sfxCmd = program
  .command('sfx')
  .alias('sound')
  .description('Sound effects generation');

sfxCmd
  .command('generate <description>')
  .description('Generate sound effect from text description')
  .option('-d, --duration <seconds>', 'Duration in seconds')
  .option('-o, --output <file>', 'Output file path')
  .option('--influence <value>', 'Prompt influence (0-1)', '0.3')
  .action(async (description: string, opts) => {
    try {
      const client = getClient();

      info(`Generating sound effect: "${description}"...`);

      const audio = await client.soundEffects.generate(description, {
        durationSeconds: opts.duration ? parseFloat(opts.duration) : undefined,
        promptInfluence: parseFloat(opts.influence),
      });

      const outputPath = opts.output || getOutputPath(`sfx_${Date.now()}`, 'mp3');
      writeFileSync(outputPath, Buffer.from(audio));
      success(`Sound effect saved to: ${outputPath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Models Commands
// ============================================
const modelsCmd = program
  .command('models')
  .description('List available models');

modelsCmd
  .command('list')
  .description('List all models')
  .action(async () => {
    try {
      const client = getClient();
      const models = await client.models.list();

      if (getFormat(modelsCmd) === 'json') {
        print(models, 'json');
      } else {
        console.log(chalk.bold(`Models (${models.length}):\n`));
        for (const model of models) {
          console.log(`  ${chalk.cyan(model.model_id)}`);
          console.log(`    ${chalk.bold(model.name)}`);
          console.log(`    ${chalk.gray(model.description.substring(0, 100))}...`);
          console.log(`    TTS: ${model.can_do_text_to_speech ? '✓' : '✗'} | STS: ${model.can_do_voice_conversion ? '✓' : '✗'} | Fine-tune: ${model.can_be_finetuned ? '✓' : '✗'}`);
          console.log();
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// History Commands
// ============================================
const historyCmd = program
  .command('history')
  .description('Generation history');

historyCmd
  .command('list')
  .description('List generation history')
  .option('-n, --max <number>', 'Maximum results', '20')
  .option('-v, --voice <voiceId>', 'Filter by voice ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.history.list({
        pageSize: parseInt(opts.max),
        voiceId: opts.voice,
      });

      if (getFormat(historyCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold(`History (${result.history.length}):\n`));
        for (const item of result.history) {
          const date = new Date(item.date_unix * 1000).toLocaleString();
          console.log(`  ${chalk.cyan(item.history_item_id)}`);
          console.log(`    Voice: ${item.voice_name} | Model: ${item.model_id}`);
          console.log(`    Text: ${chalk.gray(item.text.substring(0, 60))}...`);
          console.log(`    Date: ${date} | Characters: ${item.character_count_change_to - item.character_count_change_from}`);
          console.log();
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

historyCmd
  .command('get <historyItemId>')
  .description('Get a history item')
  .action(async (historyItemId: string) => {
    try {
      const client = getClient();
      const result = await client.history.get(historyItemId);
      print(result, getFormat(historyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

historyCmd
  .command('download <historyItemId>')
  .description('Download audio from history item')
  .option('-o, --output <file>', 'Output file path')
  .action(async (historyItemId: string, opts) => {
    try {
      const client = getClient();
      info(`Downloading audio...`);

      const audio = await client.history.getAudio(historyItemId);
      const outputPath = opts.output || getOutputPath(`history_${historyItemId}`, 'mp3');
      writeFileSync(outputPath, Buffer.from(audio));
      success(`Audio saved to: ${outputPath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

historyCmd
  .command('delete <historyItemId>')
  .description('Delete a history item')
  .action(async (historyItemId: string) => {
    try {
      const client = getClient();
      await client.history.delete(historyItemId);
      success(`History item ${historyItemId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .description('User account info');

userCmd
  .command('info')
  .description('Get user info')
  .action(async () => {
    try {
      const client = getClient();
      const user = await client.user.get();
      print(user, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('usage')
  .description('Get character usage')
  .action(async () => {
    try {
      const client = getClient();
      const usage = await client.user.getUsage();

      console.log(chalk.bold('Character Usage:\n'));
      console.log(`  Used: ${usage.characterCount.toLocaleString()} / ${usage.characterLimit.toLocaleString()}`);
      console.log(`  Remaining: ${(usage.characterLimit - usage.characterCount).toLocaleString()}`);
      console.log(`  Percent Used: ${usage.percentUsed}%`);

      const resetDate = new Date(usage.nextResetUnix * 1000);
      console.log(`  Next Reset: ${resetDate.toLocaleString()}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Quick Commands
// ============================================
program
  .command('say <text>')
  .description('Quick text-to-speech (shortcut)')
  .option('-v, --voice <voiceId>', 'Voice ID')
  .option('-o, --output <file>', 'Output file path')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const voiceId = opts.voice || getDefaultVoiceId();

      if (!voiceId) {
        error('Voice ID required. Use --voice or set default with "config set-voice"');
        process.exit(1);
      }

      info(`Generating speech...`);

      const audio = await client.speak(text, voiceId);
      const outputPath = opts.output || getOutputPath(`say_${Date.now()}`, 'mp3');
      writeFileSync(outputPath, Buffer.from(audio));
      success(`Audio saved to: ${outputPath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
