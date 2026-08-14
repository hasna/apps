#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Deepgram } from '../api';
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-deepgram';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Deepgram connector CLI - Speech-to-text and text-to-speech with multi-profile support')
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
      process.env.DEEPGRAM_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Deepgram {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set DEEPGRAM_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Deepgram({ apiKey });
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
    createProfile(name, { apiKey: opts.apiKey });
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
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Transcription Commands
// ============================================
const listenCmd = program
  .command('listen')
  .description('Speech-to-text commands');

listenCmd
  .command('url <audioUrl>')
  .description('Transcribe audio from URL')
  .option('-m, --model <model>', 'Model (nova-2, nova, enhanced, base, whisper)', 'nova-2')
  .option('-l, --language <code>', 'Language code')
  .option('--punctuate', 'Enable punctuation')
  .option('--diarize', 'Enable speaker diarization')
  .option('--smart-format', 'Enable smart formatting')
  .option('--paragraphs', 'Enable paragraph detection')
  .option('--summarize', 'Enable summarization')
  .option('--sentiment', 'Enable sentiment analysis')
  .option('--topics', 'Enable topic detection')
  .option('--utterances', 'Enable utterance detection')
  .action(async (audioUrl: string, opts) => {
    try {
      const client = getClient();
      const result = await client.transcribeUrl(audioUrl, {
        model: opts.model as any,
        language: opts.language,
        punctuate: opts.punctuate || undefined,
        diarize: opts.diarize || undefined,
        smart_format: opts.smartFormat || undefined,
        paragraphs: opts.paragraphs || undefined,
        summarize: opts.summarize || undefined,
        sentiment: opts.sentiment || undefined,
        topics: opts.topics || undefined,
        utterances: opts.utterances || undefined,
      });

      const format = getFormat(listenCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success('Transcription complete');
        info(`Duration: ${result.metadata.duration}s`);
        info(`Model: ${result.metadata.models.join(', ')}`);

        const transcript = result.results.channels[0]?.alternatives[0]?.transcript;
        if (transcript) {
          console.log(chalk.bold('\nTranscript:'));
          console.log(transcript);
        }

        if (result.results.summary?.short) {
          console.log(chalk.bold('\nSummary:'));
          console.log(result.results.summary.short);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Text-to-Speech Commands
// ============================================
const speakCmd = program
  .command('speak')
  .description('Text-to-speech commands');

speakCmd
  .command('generate <text>')
  .description('Generate speech from text')
  .option('-m, --model <model>', 'Voice model (aura-asteria-en, aura-luna-en, aura-stella-en, etc.)', 'aura-asteria-en')
  .option('-o, --output <file>', 'Output file path')
  .option('-e, --encoding <encoding>', 'Audio encoding (mp3, linear16, mulaw, alaw, opus, flac, aac)', 'mp3')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const result = await client.speak(text, {
        model: opts.model,
        encoding: opts.encoding as any,
      });

      if (opts.output) {
        const fs = await import('fs');
        fs.writeFileSync(opts.output, result.audio);
        success(`Audio saved to ${opts.output}`);
        info(`Characters: ${result.characters}`);
        info(`Model: ${result.modelName}`);
      } else {
        const format = getFormat(speakCmd);
        if (format === 'json') {
          print({
            contentType: result.contentType,
            characters: result.characters,
            modelName: result.modelName,
            audioSize: result.audio.length,
          }, format);
        } else {
          success('Speech generated');
          info(`Characters: ${result.characters}`);
          info(`Model: ${result.modelName}`);
          info(`Audio size: ${result.audio.length} bytes`);
          info('Use --output <file> to save the audio');
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Project Commands
// ============================================
const projectCmd = program
  .command('project')
  .description('Project management commands');

projectCmd
  .command('list')
  .description('List projects')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listProjects();
      const format = getFormat(projectCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success('Projects:');
        result.projects.forEach(p => {
          console.log(`  ${p.name} (${p.project_id})`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('balance <projectId>')
  .description('Get project balance')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      const result = await client.getBalance(projectId);
      const format = getFormat(projectCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success('Balances:');
        result.balances.forEach(b => {
          console.log(`  ${b.amount} ${b.units}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
