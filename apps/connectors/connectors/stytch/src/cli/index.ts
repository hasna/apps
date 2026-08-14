#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Stytch } from '../api';
import {
  getProjectId,
  getSecret,
  getEnvironment,
  setProjectId,
  setSecret,
  setEnvironment,
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

const CONNECTOR_NAME = 'connect-stytch';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stytch connector CLI - passwordless auth, MFA, sessions, and user management')
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

function getClient(): Stytch {
  const projectId = getProjectId();
  const secret = getSecret();
  if (!projectId) {
    error(`No Stytch project ID configured. Run "${CONNECTOR_NAME} config set" or set STYTCH_PROJECT_ID.`);
    process.exit(1);
  }
  if (!secret) {
    error(`No Stytch secret configured. Run "${CONNECTOR_NAME} config set" or set STYTCH_SECRET.`);
    process.exit(1);
  }
  return new Stytch({ projectId, secret, environment: getEnvironment() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  });
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .option('--project-id <id>', 'Stytch project ID')
  .option('--secret <secret>', 'Stytch secret')
  .option('--environment <env>', 'live or test')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      projectId: opts.projectId,
      secret: opts.secret,
      environment: opts.environment === 'test' ? 'test' : opts.environment === 'live' ? 'live' : undefined,
    });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Project ID: ${config.projectId ? `${config.projectId.substring(0, 12)}...` : chalk.gray('not set')}`);
  info(`Secret: ${config.secret ? '********' : chalk.gray('not set')}`);
  info(`Environment: ${config.environment || 'live'}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set')
  .requiredOption('--project-id <id>', 'Stytch project ID')
  .requiredOption('--secret <secret>', 'Stytch API secret')
  .option('--environment <env>', 'live or test', 'live')
  .action((opts) => {
    setProjectId(opts.projectId);
    setSecret(opts.secret);
    setEnvironment(opts.environment === 'test' ? 'test' : 'live');
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd.command('show').action(() => {
  const profileName = getCurrentProfile();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Project ID: ${getProjectId() ? `${getProjectId()!.substring(0, 12)}...` : chalk.gray('not set')}`);
  info(`Secret: ${getSecret() ? '********' : chalk.gray('not set')}`);
  info(`Environment: ${getEnvironment()}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success('Configuration cleared');
});

// Users commands
const usersCmd = program.command('users').description('User management');

usersCmd
  .command('search')
  .option('--limit <n>', 'Result limit', parseInt)
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--query <json>', 'Search query JSON')
  .action(async (opts, cmd) => {
    const api = getClient();
    const result = await api.users.search({
      limit: opts.limit,
      cursor: opts.cursor,
      query: parseJsonOption(opts.query, '--query'),
    });
    print(result, getFormat(cmd));
  });

usersCmd.command('get <userId>').action(async (userId: string, _, cmd) => {
  const api = getClient();
  print(await api.users.get(userId), getFormat(cmd));
});

usersCmd
  .command('create')
  .option('--email <email>', 'User email')
  .option('--phone <phone>', 'Phone number')
  .option('--pending', 'Create as pending user')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(
      await api.users.create({
        email: opts.email,
        phone_number: opts.phone,
        create_user_as_pending: opts.pending,
      }),
      getFormat(cmd),
    );
  });

usersCmd
  .command('update <userId>')
  .option('--json <body>', 'Update body JSON')
  .action(async (userId: string, opts, cmd) => {
    const body = parseJsonOption(opts.json, '--json') || {};
    const api = getClient();
    print(await api.users.update(userId, body), getFormat(cmd));
  });

usersCmd.command('delete <userId>').action(async (userId: string, _, cmd) => {
  const api = getClient();
  print(await api.users.delete(userId), getFormat(cmd));
});

// Magic links
const magicCmd = program.command('magic-links').description('Magic link authentication');

magicCmd
  .command('send')
  .requiredOption('--email <email>', 'Recipient email')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.magicLinks.sendByEmail({ email: opts.email }), getFormat(cmd));
  });

magicCmd
  .command('login-or-create')
  .requiredOption('--email <email>', 'Recipient email')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.magicLinks.loginOrCreate({ email: opts.email }), getFormat(cmd));
  });

magicCmd
  .command('authenticate')
  .requiredOption('--token <token>', 'Magic link token')
  .option('--session-duration <minutes>', 'Session duration', parseInt)
  .action(async (opts, cmd) => {
    const api = getClient();
    print(
      await api.magicLinks.authenticate({
        token: opts.token,
        session_duration_minutes: opts.sessionDuration,
      }),
      getFormat(cmd),
    );
  });

// Passwords
const passwordsCmd = program.command('passwords').description('Password authentication');

passwordsCmd
  .command('create')
  .requiredOption('--email <email>', 'User email')
  .requiredOption('--password <password>', 'Password')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.passwords.create({ email: opts.email, password: opts.password }), getFormat(cmd));
  });

passwordsCmd
  .command('authenticate')
  .requiredOption('--email <email>', 'User email')
  .requiredOption('--password <password>', 'Password')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.passwords.authenticate({ email: opts.email, password: opts.password }), getFormat(cmd));
  });

passwordsCmd
  .command('reset-start')
  .requiredOption('--email <email>', 'User email')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.passwords.resetByEmailStart({ email: opts.email }), getFormat(cmd));
  });

// Sessions
const sessionsCmd = program.command('sessions').description('Session management');

sessionsCmd
  .command('list')
  .requiredOption('--user-id <userId>', 'User ID')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.sessions.list(opts.userId), getFormat(cmd));
  });

sessionsCmd
  .command('authenticate')
  .option('--session-token <token>', 'Session token')
  .option('--session-jwt <jwt>', 'Session JWT')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(
      await api.sessions.authenticate({
        session_token: opts.sessionToken,
        session_jwt: opts.sessionJwt,
      }),
      getFormat(cmd),
    );
  });

sessionsCmd
  .command('revoke')
  .option('--session-id <id>', 'Session ID')
  .option('--session-token <token>', 'Session token')
  .option('--user-id <userId>', 'User ID')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(
      await api.sessions.revoke({
        session_id: opts.sessionId,
        session_token: opts.sessionToken,
        user_id: opts.userId,
      }),
      getFormat(cmd),
    );
  });

// OTP
const otpCmd = program.command('otp').description('One-time passcodes');

otpCmd
  .command('email-send')
  .requiredOption('--email <email>', 'Recipient email')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.otp.sendEmail({ email: opts.email }), getFormat(cmd));
  });

otpCmd
  .command('sms-send')
  .requiredOption('--phone <phone>', 'Phone number')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.otp.sendSms({ phone_number: opts.phone }), getFormat(cmd));
  });

otpCmd
  .command('authenticate')
  .requiredOption('--method-id <id>', 'OTP method ID')
  .requiredOption('--code <code>', 'OTP code')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.otp.authenticate({ method_id: opts.methodId, code: opts.code }), getFormat(cmd));
  });

// TOTP
const totpCmd = program.command('totp').description('Time-based OTP');

totpCmd
  .command('create')
  .requiredOption('--user-id <userId>', 'User ID')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.totp.create({ user_id: opts.userId }), getFormat(cmd));
  });

totpCmd
  .command('authenticate')
  .requiredOption('--user-id <userId>', 'User ID')
  .requiredOption('--code <code>', 'TOTP code')
  .action(async (opts, cmd) => {
    const api = getClient();
    print(await api.totp.authenticate({ user_id: opts.userId, totp_code: opts.code }), getFormat(cmd));
  });

program.parse();
