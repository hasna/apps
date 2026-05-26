#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Speechify } from '../api';
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

const CONNECTOR_NAME = 'connect-speechify';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Speechify connector CLI - Text-to-speech with multi-profile support')
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
      process.env.SPEECHIFY_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Speechify {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SPEECHIFY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Speechify({ apiKey });
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
// Voice Commands
// ============================================
const voiceCmd = program
  .command('voice')
  .description('Voice management commands');

voiceCmd
  .command('list')
  .description('List all available voices')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listVoices();
      const format = getFormat(voiceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Voices (${result.voices.length}):`);
        result.voices.forEach(v => {
          const type = v.type ? chalk.gray(` [${v.type}]`) : '';
          const lang = v.language ? chalk.cyan(` (${v.language})`) : '';
          console.log(`  ${v.name}${type}${lang}`);
          console.log(`    ID: ${v.id}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voiceCmd
  .command('get <voiceId>')
  .description('Get voice details')
  .action(async (voiceId: string) => {
    try {
      const client = getClient();
      const result = await client.getVoice(voiceId);
      const format = getFormat(voiceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Voice: ${result.name}`));
        info(`ID: ${result.id}`);
        info(`Type: ${result.type}`);
        if (result.gender) info(`Gender: ${result.gender}`);
        if (result.language) info(`Language: ${result.language}`);
        if (result.preview_url) info(`Preview: ${result.preview_url}`);
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
  .option('-d, --description <desc>', 'Voice description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.cloneVoice({
        name: opts.name,
        sample_url: opts.url,
        description: opts.description,
      });
      const format = getFormat(voiceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success('Voice cloned successfully!');
        info(`Name: ${result.voice.name}`);
        info(`ID: ${result.voice.id}`);
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
      await client.deleteVoice(voiceId);
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
  .option('-e, --encoding <format>', 'Audio format (mp3, wav, ogg, aac)', 'mp3')
  .option('-s, --speed <speed>', 'Speech speed (0.5-2.0)', '1.0')
  .option('--pitch <pitch>', 'Speech pitch (-20 to 20)', '0')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const result = await client.speak(text, opts.voice, {
        audio_format: opts.encoding as any,
        speed: parseFloat(opts.speed),
        pitch: parseInt(opts.pitch),
      });

      if (opts.output) {
        const fs = await import('fs');
        fs.writeFileSync(opts.output, result.audio);
        success(`Audio saved to ${opts.output}`);
        info(`Size: ${result.audio.length} bytes`);
      } else {
        const format = getFormat(speakCmd);
        if (format === 'json') {
          print({
            contentType: result.contentType,
            audioSize: result.audio.length,
          }, format);
        } else {
          success('Speech generated');
          info(`Content-Type: ${result.contentType}`);
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
// Usage Commands
// ============================================
const usageCmd = program
  .command('usage')
  .description('Get usage statistics')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getUsage();
      const format = getFormat(program);
      if (format === 'json') {
        print(result, format);
      } else {
        success('Usage Statistics:');
        info(`Characters used: ${result.characters_used.toLocaleString()}`);
        info(`Characters limit: ${result.characters_limit.toLocaleString()}`);
        info(`Period: ${result.period_start} to ${result.period_end}`);
        const percentage = ((result.characters_used / result.characters_limit) * 100).toFixed(1);
        info(`Usage: ${percentage}%`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
