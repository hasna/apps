#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Resemble } from '../api';
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

const CONNECTOR_NAME = 'connect-resemble';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Resemble AI connector CLI - Voice cloning and text-to-speech')
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
      process.env.RESEMBLE_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Resemble {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set RESEMBLE_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Resemble({ apiKey });
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
  .description('List all voices')
  .option('--page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listVoices(parseInt(opts.page));
      const format = getFormat(voiceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Voices (page ${result.page}/${result.num_pages}):`);
        result.items.forEach(v => {
          const status = v.status === 'ready' ? chalk.green('[ready]') : chalk.yellow(`[${v.status}]`);
          console.log(`  ${v.name} ${status}`);
          console.log(`    UUID: ${v.uuid}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voiceCmd
  .command('get <voiceUuid>')
  .description('Get voice details')
  .action(async (voiceUuid: string) => {
    try {
      const client = getClient();
      const result = await client.getVoice(voiceUuid);
      const format = getFormat(voiceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Voice: ${result.name}`));
        info(`UUID: ${result.uuid}`);
        info(`Status: ${result.status}`);
        info(`Created: ${result.created_at}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voiceCmd
  .command('create')
  .description('Create a new voice')
  .requiredOption('-n, --name <name>', 'Voice name')
  .option('-u, --dataset-url <url>', 'URL to training dataset')
  .option('--callback <uri>', 'Callback URI for completion')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createVoice({
        name: opts.name,
        dataset_url: opts.datasetUrl,
        callback_uri: opts.callback,
      });
      const format = getFormat(voiceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success('Voice created!');
        info(`Name: ${result.name}`);
        info(`UUID: ${result.uuid}`);
        info(`Status: ${result.status}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

voiceCmd
  .command('delete <voiceUuid>')
  .description('Delete a voice')
  .action(async (voiceUuid: string) => {
    try {
      const client = getClient();
      await client.deleteVoice(voiceUuid);
      success('Voice deleted successfully');
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
  .description('List all projects')
  .option('--page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listProjects(parseInt(opts.page));
      const format = getFormat(projectCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Projects (page ${result.page}/${result.num_pages}):`);
        result.items.forEach(p => {
          console.log(`  ${p.name}`);
          console.log(`    UUID: ${p.uuid}`);
          if (p.description) console.log(`    ${chalk.gray(p.description)}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('get <projectUuid>')
  .description('Get project details')
  .action(async (projectUuid: string) => {
    try {
      const client = getClient();
      const result = await client.getProject(projectUuid);
      const format = getFormat(projectCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Project: ${result.name}`));
        info(`UUID: ${result.uuid}`);
        if (result.description) info(`Description: ${result.description}`);
        info(`Created: ${result.created_at}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Speak Commands
// ============================================
const speakCmd = program
  .command('speak')
  .description('Text-to-speech commands');

speakCmd
  .command('generate <text>')
  .description('Generate speech from text')
  .requiredOption('--project <uuid>', 'Project UUID')
  .requiredOption('--voice <uuid>', 'Voice UUID')
  .option('-o, --output <file>', 'Output file path')
  .option('-e, --encoding <format>', 'Audio format (mp3, wav)', 'mp3')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const result = await client.speak(opts.project, opts.voice, text, {
        output_format: opts.encoding as any,
      });

      if (opts.output) {
        const fs = await import('fs');
        fs.writeFileSync(opts.output, result.audio);
        success(`Audio saved to ${opts.output}`);
        info(`Size: ${result.audio.length} bytes`);
        info(`URL: ${result.audioUrl}`);
      } else {
        const format = getFormat(speakCmd);
        if (format === 'json') {
          print({
            audioSize: result.audio.length,
            audioUrl: result.audioUrl,
          }, format);
        } else {
          success('Speech generated');
          info(`Audio size: ${result.audio.length} bytes`);
          info(`URL: ${result.audioUrl}`);
          info('Use --output <file> to save the audio');
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Clip Commands
// ============================================
const clipCmd = program
  .command('clip')
  .description('Clip management commands');

clipCmd
  .command('list <projectUuid>')
  .description('List clips in a project')
  .option('--page <page>', 'Page number', '1')
  .action(async (projectUuid: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listClips(projectUuid, parseInt(opts.page));
      const format = getFormat(clipCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Clips (page ${result.page}/${result.num_pages}):`);
        result.items.forEach(c => {
          console.log(`  ${c.title || 'Untitled'}`);
          console.log(`    UUID: ${c.uuid}`);
          console.log(`    Text: ${c.body.substring(0, 50)}${c.body.length > 50 ? '...' : ''}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

clipCmd
  .command('get <projectUuid> <clipUuid>')
  .description('Get clip details')
  .action(async (projectUuid: string, clipUuid: string) => {
    try {
      const client = getClient();
      const result = await client.getClip(projectUuid, clipUuid);
      const format = getFormat(clipCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Clip: ${result.title || 'Untitled'}`));
        info(`UUID: ${result.uuid}`);
        info(`Text: ${result.body}`);
        if (result.audio_src) info(`Audio: ${result.audio_src}`);
        info(`Created: ${result.created_at}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

clipCmd
  .command('delete <projectUuid> <clipUuid>')
  .description('Delete a clip')
  .action(async (projectUuid: string, clipUuid: string) => {
    try {
      const client = getClient();
      await client.deleteClip(projectUuid, clipUuid);
      success('Clip deleted successfully');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
