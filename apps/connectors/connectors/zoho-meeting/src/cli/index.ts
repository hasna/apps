#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoMeeting } from '../api';
import {
  getToken,
  setToken,
  getDataCenter,
  setDataCenter,
  getBaseUrl,
  setBaseUrl,
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

const CONNECTOR_NAME = 'connect-zoho-meeting';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Meeting connector CLI - sessions, webinars, recordings, and reports')
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

function getClient(): ZohoMeeting {
  const token = getToken();
  if (!token) {
    error(`No Zoho Meeting token configured. Run "${CONNECTOR_NAME} config set --token <token>" or set ZOHO_MEETING_TOKEN.`);
    process.exit(1);
  }

  return new ZohoMeeting({
    token,
    dataCenter: getDataCenter(),
    baseUrl: getBaseUrl(),
  });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  }
});

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'OAuth access token')
  .option('--data-center <dc>', 'Data center (com, eu, in, com.au, jp, ca, sa)')
  .option('--base-url <url>', 'Override API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      token: opts.token,
      dataCenter: opts.dataCenter,
      baseUrl: opts.baseUrl,
    });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Token: ${config.token ? `${config.token.substring(0, 4)}...` : chalk.gray('not set')}`);
  info(`Data center: ${config.dataCenter || chalk.gray('com (default)')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set')
  .description('Set Zoho Meeting credentials')
  .requiredOption('--token <token>', 'OAuth access token')
  .option('--data-center <dc>', 'Data center', 'com')
  .option('--base-url <url>', 'Override API base URL')
  .action((opts) => {
    setToken(opts.token);
    setDataCenter(opts.dataCenter);
    if (opts.baseUrl) setBaseUrl(opts.baseUrl);
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd.command('show').description('Show current configuration').action(() => {
  const token = getToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Data center: ${getDataCenter()}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
  info(`Token: ${token ? `${token.substring(0, 4)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const sessionsCmd = program.command('sessions').description('Meeting session operations');

sessionsCmd
  .command('list')
  .description('List sessions')
  .option('--from <n>', 'Pagination offset', parseInt)
  .option('--limit <n>', 'Page size', parseInt)
  .option('--type <type>', 'all | upcoming | past | ondemand | recurring')
  .action(async (opts) => {
    try {
      const client = getClient();
      print(await client.sessions.list({ from: opts.from, limit: opts.limit, type: opts.type }), getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd.command('get <sessionKey>').description('Get session details').action(async (sessionKey: string) => {
  try {
    print(await getClient().sessions.get(sessionKey), getFormat(sessionsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

sessionsCmd
  .command('create <topic>')
  .description('Create a session')
  .requiredOption('--start <datetime>', 'Start time (ISO 8601)')
  .requiredOption('--duration <minutes>', 'Duration in minutes', parseInt)
  .option('--agenda <text>', 'Agenda')
  .option('--timezone <tz>', 'Timezone')
  .action(async (topic: string, opts) => {
    try {
      const result = await getClient().sessions.create({
        topic,
        startTime: opts.start,
        duration: opts.duration,
        agenda: opts.agenda,
        timezone: opts.timezone,
      });
      success('Session created');
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('update <sessionKey>')
  .description('Update a session')
  .option('--topic <topic>', 'Topic')
  .option('--start <datetime>', 'Start time')
  .option('--duration <minutes>', 'Duration', parseInt)
  .action(async (sessionKey: string, opts) => {
    try {
      await getClient().sessions.update(sessionKey, {
        topic: opts.topic,
        startTime: opts.start,
        duration: opts.duration,
      });
      success(`Session ${sessionKey} updated`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd.command('delete <sessionKey>').description('Delete a session').action(async (sessionKey: string) => {
  try {
    await getClient().sessions.delete(sessionKey);
    success(`Session ${sessionKey} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

sessionsCmd.command('start <sessionKey>').description('Start a session').action(async (sessionKey: string) => {
  try {
    print(await getClient().sessions.start(sessionKey), getFormat(sessionsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

sessionsCmd.command('end <sessionKey>').description('End a session').action(async (sessionKey: string) => {
  try {
    print(await getClient().sessions.end(sessionKey), getFormat(sessionsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const participantsCmd = program.command('participants').description('Session participant operations');

participantsCmd
  .command('list <sessionKey>')
  .description('List participants')
  .option('--from <n>', 'Pagination offset', parseInt)
  .option('--limit <n>', 'Page size', parseInt)
  .action(async (sessionKey: string, opts) => {
    try {
      print(await getClient().participants.list(sessionKey, { from: opts.from, limit: opts.limit }), getFormat(participantsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

participantsCmd
  .command('add <sessionKey> <email>')
  .description('Add a participant')
  .option('--name <name>', 'Participant name')
  .action(async (sessionKey: string, email: string, opts) => {
    try {
      print(await getClient().participants.add(sessionKey, [{ email, name: opts.name }]), getFormat(participantsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

participantsCmd
  .command('remove <sessionKey> <participantId>')
  .description('Remove a participant')
  .action(async (sessionKey: string, participantId: string) => {
    try {
      await getClient().participants.remove(sessionKey, participantId);
      success('Participant removed');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const webinarsCmd = program.command('webinars').description('Webinar operations');

webinarsCmd
  .command('list')
  .description('List webinars')
  .option('--from <n>', 'Pagination offset', parseInt)
  .option('--limit <n>', 'Page size', parseInt)
  .option('--type <type>', 'all | upcoming | past | ondemand')
  .action(async (opts) => {
    try {
      print(await getClient().webinars.list({ from: opts.from, limit: opts.limit, type: opts.type }), getFormat(webinarsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webinarsCmd.command('get <webinarKey>').description('Get webinar details').action(async (webinarKey: string) => {
  try {
    print(await getClient().webinars.get(webinarKey), getFormat(webinarsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

webinarsCmd
  .command('create <topic>')
  .description('Create a webinar')
  .requiredOption('--start <datetime>', 'Start time')
  .requiredOption('--duration <minutes>', 'Duration', parseInt)
  .option('--agenda <text>', 'Agenda')
  .action(async (topic: string, opts) => {
    try {
      const result = await getClient().webinars.create({
        topic,
        startTime: opts.start,
        duration: opts.duration,
        agenda: opts.agenda,
      });
      success('Webinar created');
      print(result, getFormat(webinarsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webinarsCmd
  .command('update <webinarKey>')
  .description('Update a webinar')
  .option('--topic <topic>', 'Topic')
  .option('--start <datetime>', 'Start time')
  .option('--duration <minutes>', 'Duration', parseInt)
  .action(async (webinarKey: string, opts) => {
    try {
      await getClient().webinars.update(webinarKey, {
        topic: opts.topic,
        startTime: opts.start,
        duration: opts.duration,
      });
      success(`Webinar ${webinarKey} updated`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webinarsCmd.command('delete <webinarKey>').description('Delete a webinar').action(async (webinarKey: string) => {
  try {
    await getClient().webinars.delete(webinarKey);
    success(`Webinar ${webinarKey} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

webinarsCmd.command('start <webinarKey>').description('Start a webinar').action(async (webinarKey: string) => {
  try {
    print(await getClient().webinars.start(webinarKey), getFormat(webinarsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

webinarsCmd
  .command('registrants <webinarKey>')
  .description('List webinar registrants')
  .option('--status <status>', 'approved | pending | denied')
  .action(async (webinarKey: string, opts) => {
    try {
      print(await getClient().webinars.listRegistrants(webinarKey, { status: opts.status }), getFormat(webinarsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webinarsCmd
  .command('register <webinarKey> <email> <firstName>')
  .description('Register an attendee')
  .option('--last-name <name>', 'Last name')
  .action(async (webinarKey: string, email: string, firstName: string, opts) => {
    try {
      print(
        await getClient().webinars.register(webinarKey, { email, firstName, lastName: opts.lastName }),
        getFormat(webinarsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webinarsCmd
  .command('approve <webinarKey> <registrantIds...>')
  .description('Approve registrants')
  .action(async (webinarKey: string, registrantIds: string[]) => {
    try {
      print(await getClient().webinars.approve(webinarKey, registrantIds), getFormat(webinarsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webinarsCmd
  .command('deny <webinarKey> <registrantIds...>')
  .description('Deny registrants')
  .action(async (webinarKey: string, registrantIds: string[]) => {
    try {
      print(await getClient().webinars.deny(webinarKey, registrantIds), getFormat(webinarsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webinarsCmd.command('polls <webinarKey>').description('List webinar polls').action(async (webinarKey: string) => {
  try {
    print(await getClient().webinars.listPolls(webinarKey), getFormat(webinarsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const recordingsCmd = program.command('recordings').description('Recording operations');

recordingsCmd
  .command('list')
  .description('List recordings')
  .option('--session-key <key>', 'Filter by session key')
  .option('--webinar-key <key>', 'Filter by webinar key')
  .option('--type <type>', 'meeting | webinar')
  .action(async (opts) => {
    try {
      print(
        await getClient().recordings.list({
          sessionKey: opts.sessionKey,
          webinarKey: opts.webinarKey,
          type: opts.type,
        }),
        getFormat(recordingsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordingsCmd.command('get <recordingId>').description('Get recording details').action(async (recordingId: string) => {
  try {
    print(await getClient().recordings.get(recordingId), getFormat(recordingsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

recordingsCmd.command('delete <recordingId>').description('Delete a recording').action(async (recordingId: string) => {
  try {
    await getClient().recordings.delete(recordingId);
    success(`Recording ${recordingId} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const reportsCmd = program.command('reports').description('Report operations');

reportsCmd.command('session <sessionKey>').description('Get session report').action(async (sessionKey: string) => {
  try {
    print(await getClient().reports.getSessionReport(sessionKey), getFormat(reportsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

reportsCmd.command('webinar <webinarKey>').description('Get webinar report').action(async (webinarKey: string) => {
  try {
    print(await getClient().reports.getWebinarReport(webinarKey), getFormat(reportsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.parse();
