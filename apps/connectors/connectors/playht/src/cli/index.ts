#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { PlayHT } from '../api';
import {
  getApiKey,
  setApiKey,
  getUserId,
  setUserId,
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

const CONNECTOR_NAME = 'connect-playht';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('PlayHT connector CLI - Text-to-speech with voice cloning support')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --user-id <id>', 'User ID (overrides config)')
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
      process.env.PLAYHT_API_KEY = opts.apiKey;
    }
    if (opts.userId) {
      process.env.PLAYHT_USER_ID = opts.userId;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): PlayHT {
  const apiKey = getApiKey();
  const userId = getUserId();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set PLAYHT_API_KEY environment variable.`);
    process.exit(1);
  }
  if (!userId) {
    error(`No User ID configured. Run "${CONNECTOR_NAME} config set-user <id>" or set PLAYHT_USER_ID environment variable.`);
    process.exit(1);
  }
  return new PlayHT({ apiKey, userId });
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
  .option('--user-id <id>', 'User ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, userId: opts.userId });
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
    info(`User ID: ${config.userId || chalk.gray('not set')}`);
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
  .command('set-user <userId>')
  .description('Set User ID')
  .action((userId: string) => {
    setUserId(userId);
    success(`User ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const userId = getUserId();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`User ID: ${userId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Voice Commands
// ============================================
const voiceCmd = program
  .command('voice')
  .description('Voice management commands');

voiceCmd
  .command('list')
  .description('List all stock voices')
  .option('-l, --language <lang>', 'Filter by language')
  .option('-g, --gender <gender>', 'Filter by gender')
  .action(async (opts) => {
    try {
      const client = getClient();
      let voices = await client.listVoices();

      if (opts.language) {
        voices = voices.filter(v =>
          v.language?.toLowerCase().includes(opts.language.toLowerCase()) ||
          v.language_code?.toLowerCase().includes(opts.language.toLowerCase())
        );
      }
      if (opts.gender) {
        voices = voices.filter(v =>
          v.gender?.toLowerCase() === opts.gender.toLowerCase()
        );
      }

      const format = getFormat(voiceCmd);
      if (format === 'json') {
        print(voices, format);
      } else {
        success(`Stock Voices (${voices.length}):`);
        voices.slice(0, 20).forEach(v => {
          const gender = v.gender ? chalk.cyan(` [${v.gender}]`) : '';
          const lang = v.language ? chalk.gray(` (${v.language})`) : '';
          console.log(`  ${v.name}${gender}${lang}`);
          console.log(`    ID: ${v.id}`);
        });
        if (voices.length > 20) {
          info(`... and ${voices.length - 20} more voices`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voiceCmd
  .command('cloned')
  .description('List cloned voices')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listClonedVoices();
      const format = getFormat(voiceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Cloned Voices (${result.voices.length}):`);
        result.voices.forEach(v => {
          const type = chalk.cyan(` [${v.type}]`);
          console.log(`  ${v.name}${type}`);
          console.log(`    ID: ${v.id}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voiceCmd
  .command('clone')
  .description('Clone a voice from audio sample')
  .requiredOption('-n, --name <name>', 'Name for the cloned voice')
  .option('-u, --url <url>', 'URL to audio sample')
  .option('--instant', 'Use instant cloning (faster but lower quality)')
  .action(async (opts) => {
    try {
      const client = getClient();
      let result;

      if (opts.instant) {
        if (!opts.url) {
          error('--url is required for instant cloning');
          process.exit(1);
        }
        result = await client.instantCloneVoice({
          voice_name: opts.name,
          sample_file_url: opts.url,
        });
      } else {
        result = await client.cloneVoice({
          voice_name: opts.name,
          sample_file_url: opts.url,
        });
      }

      const format = getFormat(voiceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success('Voice cloned successfully!');
        info(`Name: ${result.name}`);
        info(`ID: ${result.id}`);
        info(`Status: ${result.status}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voiceCmd
  .command('delete <voiceId>')
  .description('Delete a cloned voice')
  .action(async (voiceId: string) => {
    try {
      const client = getClient();
      await client.deleteClonedVoice(voiceId);
      success('Voice deleted successfully');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Speech Commands
// ============================================
const speakCmd = program
  .command('speak')
  .description('Text-to-speech commands');

speakCmd
  .command('generate <text>')
  .description('Generate speech from text')
  .requiredOption('-v, --voice <voiceId>', 'Voice ID to use')
  .option('-o, --output <file>', 'Output file path')
  .option('-e, --encoding <format>', 'Audio format (mp3, wav, ogg, flac, mulaw)', 'mp3')
  .option('--engine <engine>', 'Voice engine (PlayHT2.0, PlayHT2.0-turbo, PlayHT1.0, Standard)', 'PlayHT2.0-turbo')
  .option('-q, --quality <quality>', 'Quality (draft, low, medium, high, premium)', 'medium')
  .option('-s, --speed <speed>', 'Speech speed (0.5-2.0)', '1.0')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const result = await client.speak(text, opts.voice, {
        output_format: opts.encoding as any,
        voice_engine: opts.engine as any,
        quality: opts.quality as any,
        speed: parseFloat(opts.speed),
      });

      if (opts.output) {
        const fs = await import('fs');
        fs.writeFileSync(opts.output, result.audio);
        success(`Audio saved to ${opts.output}`);
        info(`Size: ${result.audio.length} bytes`);
        if (result.url) info(`URL: ${result.url}`);
      } else {
        const format = getFormat(speakCmd);
        if (format === 'json') {
          print({
            contentType: result.contentType,
            audioSize: result.audio.length,
            url: result.url,
          }, format);
        } else {
          success('Speech generated');
          info(`Content-Type: ${result.contentType}`);
          info(`Audio size: ${result.audio.length} bytes`);
          if (result.url) info(`URL: ${result.url}`);
          info('Use --output <file> to save the audio');
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
