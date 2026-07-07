#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoRecruit } from '../api';
import {
  getToken,
  setToken,
  getDataCenter,
  setDataCenter,
  getBaseUrl,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'zohorecruit';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Recruit ATS connector CLI')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.token) {
      process.env.ZOHORECRUIT_TOKEN = opts.token;
    }
  });

export function getFormat(cmd: Command): OutputFormat {
  const opts = cmd.optsWithGlobals();
  return (opts.format || cmd.parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoRecruit {
  const token = getToken();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHORECRUIT_TOKEN.`);
    process.exit(1);
  }
  return new ZohoRecruit({
    token,
    dataCenter: getDataCenter(),
    baseUrl: getBaseUrl(),
  });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  }
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').option('--token <token>', 'OAuth token').option('--use', 'Switch after create').action((name: string, opts) => {
  if (profileExists(name)) {
    error(`Profile "${name}" already exists`);
    process.exit(1);
  }
  createProfile(name, { token: opts.token });
  success(`Profile "${name}" created`);
  if (opts.use) setCurrentProfile(name);
});

profileCmd.command('delete <name>').action((name: string) => {
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
  info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Data center: ${config.dataCenter || chalk.gray('com (default)')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-dc <dataCenter>').description('Set data center (com, eu, in, com.au, jp, ca, sa)').action((dataCenter: string) => {
  setDataCenter(dataCenter);
  success(`Data center saved: ${dataCenter}`);
});

configCmd.command('show').action(() => {
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${getToken() ? `${getToken()!.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Data center: ${getDataCenter() || 'com'}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const recordsCmd = program.command('records').description('Record CRUD and search');

recordsCmd
  .command('list <module>')
  .option('--page <n>', 'Page number', '1')
  .option('--per-page <n>', 'Records per page', '200')
  .option('--fields <fields>', 'Comma-separated fields')
  .action(async (module: string, opts) => {
    try {
      const result = await getClient().listRecords(module, {
        page: Number(opts.page),
        per_page: Number(opts.perPage),
        fields: opts.fields,
      });
      print(result, getFormat(recordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordsCmd.command('get <module> <id>').action(async (module: string, id: string) => {
  try {
    print(await getClient().getRecord(module, id), getFormat(recordsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

recordsCmd
  .command('search <module>')
  .option('--criteria <criteria>', 'Search criteria')
  .option('--email <email>', 'Search by email')
  .option('--phone <phone>', 'Search by phone')
  .option('--word <word>', 'Search by word')
  .action(async (module: string, opts) => {
    try {
      print(await getClient().searchRecords(module, opts), getFormat(recordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const jobsCmd = program.command('jobs').description('Job opening workflows');

jobsCmd.command('associate <jobId>').requiredOption('--ids <ids>', 'Comma-separated candidate IDs').action(async (jobId: string, opts) => {
  try {
    const ids = opts.ids.split(',').map((s: string) => s.trim());
    print(await getClient().associateCandidates(jobId, [{ ids }]), getFormat(jobsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

jobsCmd.command('candidates <jobId>').action(async (jobId: string) => {
  try {
    print(await getClient().getAssociatedCandidates(jobId), getFormat(jobsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

jobsCmd
  .command('status <jobId>')
  .requiredOption('--ids <ids>', 'Comma-separated candidate IDs')
  .requiredOption('--status <status>', 'New status')
  .action(async (jobId: string, opts) => {
    try {
      const ids = opts.ids.split(',').map((s: string) => s.trim());
      print(await getClient().changeCandidateStatus(jobId, [{ ids, status: opts.status }]), getFormat(jobsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const settingsCmd = program.command('settings').description('Module and field settings');

settingsCmd.command('modules').action(async () => {
  try {
    print(await getClient().listModules(), getFormat(settingsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

settingsCmd.command('fields <module>').action(async (module: string) => {
  try {
    print(await getClient().listFields(module), getFormat(settingsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.command('users').option('--type <type>', 'User filter type', 'AllUsers').action(async (opts) => {
  try {
    print(await getClient().listUsers({ type: opts.type }), getFormat(program));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.command('org').description('Get organization details').action(async () => {
  try {
    print(await getClient().getOrganization(), getFormat(program));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

if (import.meta.main) {
  program.parse();
}
