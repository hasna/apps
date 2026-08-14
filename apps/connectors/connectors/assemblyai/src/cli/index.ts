#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { AssemblyAI } from '../api';
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

const CONNECTOR_NAME = 'connect-assemblyai';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('AssemblyAI connector CLI - Speech-to-text transcription with multi-profile support')
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
      process.env.ASSEMBLYAI_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): AssemblyAI {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ASSEMBLYAI_API_KEY environment variable.`);
    process.exit(1);
  }
  return new AssemblyAI({ apiKey });
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
// Transcript Commands
// ============================================
const transcriptCmd = program
  .command('transcript')
  .description('Transcription commands');

transcriptCmd
  .command('create <audioUrl>')
  .description('Create a new transcript from audio URL')
  .option('-l, --language <code>', 'Language code (e.g., en, es, fr)')
  .option('--speaker-labels', 'Enable speaker diarization')
  .option('--speakers <number>', 'Expected number of speakers')
  .option('--punctuate', 'Enable automatic punctuation')
  .option('--format-text', 'Enable text formatting')
  .option('--summarize', 'Enable summarization')
  .option('--sentiment', 'Enable sentiment analysis')
  .option('--auto-chapters', 'Enable auto chapters')
  .option('--entity-detection', 'Enable entity detection')
  .option('--wait', 'Wait for transcript to complete')
  .action(async (audioUrl: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createTranscript({
        audio_url: audioUrl,
        language_code: opts.language,
        speaker_labels: opts.speakerLabels || undefined,
        speakers_expected: opts.speakers ? parseInt(opts.speakers) : undefined,
        punctuate: opts.punctuate || undefined,
        format_text: opts.formatText || undefined,
        summarization: opts.summarize || undefined,
        sentiment_analysis: opts.sentiment || undefined,
        auto_chapters: opts.autoChapters || undefined,
        entity_detection: opts.entityDetection || undefined,
      });

      if (opts.wait) {
        info(`Transcript ${result.id} queued. Waiting for completion...`);
        const completed = await client.waitForTranscript(result.id);
        const format = getFormat(transcriptCmd);
        if (format === 'json') {
          print(completed, format);
        } else {
          if (completed.status === 'completed') {
            success(`Transcript completed`);
            info(`ID: ${completed.id}`);
            info(`Duration: ${completed.audio_duration}s`);
            info(`Confidence: ${((completed.confidence || 0) * 100).toFixed(1)}%`);
            if (completed.text) {
              console.log(chalk.bold('\nTranscript:'));
              console.log(completed.text);
            }
            if (completed.summary) {
              console.log(chalk.bold('\nSummary:'));
              console.log(completed.summary);
            }
          } else {
            error(`Transcript failed: ${completed.error}`);
          }
        }
      } else {
        const format = getFormat(transcriptCmd);
        if (format === 'json') {
          print(result, format);
        } else {
          success(`Transcript created`);
          info(`ID: ${result.id}`);
          info(`Status: ${result.status}`);
          info(`Use "connect-assemblyai transcript get ${result.id}" to check status`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transcriptCmd
  .command('get <transcriptId>')
  .description('Get transcript by ID')
  .action(async (transcriptId: string) => {
    try {
      const client = getClient();
      const result = await client.getTranscript(transcriptId);
      const format = getFormat(transcriptCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Transcript: ${result.id}`));
        info(`Status: ${result.status}`);
        if (result.status === 'completed') {
          info(`Duration: ${result.audio_duration}s`);
          info(`Confidence: ${((result.confidence || 0) * 100).toFixed(1)}%`);
          if (result.text) {
            console.log(chalk.bold('\nTranscript:'));
            console.log(result.text);
          }
        } else if (result.status === 'error') {
          error(`Error: ${result.error}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transcriptCmd
  .command('list')
  .description('List transcripts')
  .option('-n, --limit <number>', 'Maximum results', '10')
  .option('-s, --status <status>', 'Filter by status (queued, processing, completed, error)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTranscripts(parseInt(opts.limit), opts.status);
      const format = getFormat(transcriptCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Transcripts (${result.transcripts.length}):`);
        result.transcripts.forEach(t => {
          console.log(`  ${t.id} - ${t.status} - ${t.created}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transcriptCmd
  .command('delete <transcriptId>')
  .description('Delete a transcript')
  .action(async (transcriptId: string) => {
    try {
      const client = getClient();
      await client.deleteTranscript(transcriptId);
      success(`Transcript ${transcriptId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// LeMUR Commands
// ============================================
const lemurCmd = program
  .command('lemur')
  .description('LeMUR AI commands');

lemurCmd
  .command('task <transcriptIds>')
  .description('Run a custom LeMUR task')
  .requiredOption('--prompt <prompt>', 'Task prompt')
  .option('--context <context>', 'Additional context')
  .option('--temperature <number>', 'Temperature (0-1)')
  .action(async (transcriptIds: string, opts) => {
    try {
      const client = getClient();
      const result = await client.lemurTask({
        transcript_ids: transcriptIds.split(','),
        prompt: opts.prompt,
        context: opts.context,
        temperature: opts.temperature ? parseFloat(opts.temperature) : undefined,
      });

      const format = getFormat(lemurCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success('LeMUR Response:');
        console.log(result.response);
        info(`\nTokens: ${result.usage.input_tokens} input, ${result.usage.output_tokens} output`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

lemurCmd
  .command('summary <transcriptIds>')
  .description('Generate a summary of transcripts')
  .option('--context <context>', 'Additional context')
  .action(async (transcriptIds: string, opts) => {
    try {
      const client = getClient();
      const result = await client.lemurSummary({
        transcript_ids: transcriptIds.split(','),
        context: opts.context,
      });

      const format = getFormat(lemurCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success('Summary:');
        console.log(result.response);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
