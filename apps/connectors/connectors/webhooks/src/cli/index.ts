#!/usr/bin/env bun
import { readFileSync } from 'fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { createWebhooksClient } from '../api';
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getBaseConfigDir,
  getConfigDir,
  getCurrentProfile,
  getDefaultUrl,
  getSigningSecret,
  listProfiles,
  loadProfile,
  profileExists,
  setCurrentProfile,
  setDefaultUrl,
  setProfileOverride,
  setSigningSecret,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { error, info, print, success } from '../utils/output';

const CONNECTOR_NAME = 'connect-webhooks';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Generic outbound HTTP webhook utility')
  .version(VERSION)
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
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient() {
  return createWebhooksClient();
}

function parseHeaders(values: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const value of values ?? []) {
    const separator = value.indexOf(':');
    if (separator === -1) {
      throw new Error(`Invalid header "${value}". Expected "Name: value".`);
    }
    const name = value.slice(0, separator).trim();
    const headerValue = value.slice(separator + 1).trim();
    if (!name) {
      throw new Error(`Invalid header "${value}". Header name is required.`);
    }
    headers[name] = headerValue;
  }
  return headers;
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

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
    success('Profiles:');
    for (const profile of profiles) {
      const active = profile === current ? chalk.green(' (active)') : '';
      console.log(`  ${profile}${active}`);
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--default-url <url>', 'Default webhook URL')
  .option('--signing-secret <secret>', 'HMAC signing secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { defaultUrl?: string; signingSecret?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      defaultUrl: opts.defaultUrl,
      signingSecret: opts.signingSecret,
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
    if (!deleteProfile(name)) {
      error(`Profile "${name}" could not be deleted`);
      process.exit(1);
    }
    success(`Profile "${name}" deleted`);
  });

const configCmd = program.command('config').description('Manage connector configuration');

configCmd
  .command('show')
  .description('Show current profile configuration')
  .action(() => {
    print(
      {
        profile: getCurrentProfile(),
        configDir: getConfigDir(),
        defaultUrl: getDefaultUrl(),
        signingSecretConfigured: Boolean(getSigningSecret()),
      },
      getFormat(configCmd),
    );
  });

configCmd
  .command('set-default-url <url>')
  .description('Set the default webhook URL')
  .action((url: string) => {
    setDefaultUrl(url);
    success('Default webhook URL saved');
  });

configCmd
  .command('set-signing-secret <secret>')
  .description('Set the HMAC signing secret')
  .action((secret: string) => {
    setSigningSecret(secret);
    success('Signing secret saved');
  });

configCmd
  .command('clear')
  .description('Clear profile configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

configCmd
  .command('path')
  .description('Show configuration directory')
  .action(() => {
    info(`Base config: ${getBaseConfigDir()}`);
    info(`Active profile config: ${getConfigDir()}`);
  });

program
  .command('send')
  .description('Send a webhook payload')
  .option('--url <url>', 'Webhook destination URL')
  .option('--body <body>', 'Raw request body')
  .option('--file <path>', 'Read request body from a file')
  .option('-H, --header <header>', 'Additional header (repeatable, Name: value)', collect, [])
  .action(async (opts: { url?: string; body?: string; file?: string; header: string[] }) => {
    try {
      let body: unknown = opts.body ?? '';
      if (opts.file) {
        body = readFileSync(opts.file, 'utf-8');
      }
      const result = await getClient().send({
        url: opts.url,
        body,
        headers: parseHeaders(opts.header),
      });
      print(result, getFormat(program));
      if (!result.ok) process.exit(1);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('send-json')
  .description('Send a JSON webhook payload')
  .option('--url <url>', 'Webhook destination URL')
  .requiredOption('--payload <json>', 'JSON payload string')
  .action(async (opts: { url?: string; payload: string }) => {
    try {
      const payload = JSON.parse(opts.payload) as Record<string, unknown>;
      const result = await getClient().sendJson({ url: opts.url, payload });
      print(result, getFormat(program));
      if (!result.ok) process.exit(1);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('ping')
  .description('Send a ping payload to a webhook URL')
  .option('--url <url>', 'Webhook destination URL')
  .action(async (opts: { url?: string }) => {
    try {
      const result = await getClient().ping({ url: opts.url });
      print(result, getFormat(program));
      if (!result.ok) process.exit(1);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('list-incoming')
  .description('Describe incoming webhook receiver options (stub)')
  .option('--limit <count>', 'Maximum events to return', '25')
  .option('--since-ms <ms>', 'Only include events after this timestamp')
  .action(async (opts: { limit: string; sinceMs?: string }) => {
    try {
      const result = await getClient().listIncoming({
        limit: Number(opts.limit),
        sinceMs: opts.sinceMs ? Number(opts.sinceMs) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

program.parse();
