#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Wistia } from '../api';
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-wistia';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wistia connector CLI - video hosting, projects, medias, captions, channels, and analytics')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
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

    if (opts.apiKey) {
      process.env.WISTIA_API_TOKEN = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Wistia {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set WISTIA_API_TOKEN.`);
    process.exit(1);
  }
  return new Wistia({ apiToken: apiKey });
}

function parseJsonOption(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error('Invalid JSON for --data option');
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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
  .option('--api-key <key>', 'API token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) setCurrentProfile(name);
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (!deleteProfile(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Token: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API token').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Token: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const accountCmd = program.command('account').description('Account commands');

accountCmd.command('get').description('Get account details').action(async () => {
  try {
    print(await getClient().account.get(), getFormat(accountCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

accountCmd.command('stats').description('Get account stats').action(async () => {
  try {
    print(await getClient().account.getStats(), getFormat(accountCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const projectsCmd = program.command('projects').description('Project commands');

projectsCmd
  .command('list')
  .option('--page <n>', 'Page number', parseInt)
  .option('--per-page <n>', 'Results per page', parseInt)
  .action(async (opts) => {
    try {
      print(await getClient().projects.list({ page: opts.page, perPage: opts.perPage }), getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd.command('get <hashedId>').action(async (hashedId: string) => {
  try {
    print(await getClient().projects.get(hashedId), getFormat(projectsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

projectsCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Project name')
  .option('--admin-email <email>', 'Admin email')
  .option('--public', 'Make project public')
  .action(async (opts) => {
    try {
      const result = await getClient().projects.create({
        name: opts.name,
        adminEmail: opts.adminEmail,
        isPublic: opts.public,
      });
      success('Project created');
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('update <hashedId>')
  .requiredOption('--data <json>', 'JSON update payload')
  .action(async (hashedId: string, opts) => {
    try {
      print(await getClient().projects.update(hashedId, parseJsonOption(opts.data)!), getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd.command('delete <hashedId>').action(async (hashedId: string) => {
  try {
    await getClient().projects.delete(hashedId);
    success('Project deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

projectsCmd.command('copy <hashedId>').option('--admin-email <email>').action(async (hashedId: string, opts) => {
  try {
    print(await getClient().projects.copy(hashedId, { adminEmail: opts.adminEmail }), getFormat(projectsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

projectsCmd.command('stats <hashedId>').action(async (hashedId: string) => {
  try {
    print(await getClient().projects.getStats(hashedId), getFormat(projectsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const mediasCmd = program.command('medias').description('Media commands');

mediasCmd
  .command('list')
  .option('--page <n>', 'Page number', parseInt)
  .option('--per-page <n>', 'Results per page', parseInt)
  .option('--project-id <id>', 'Filter by project')
  .option('--type <type>', 'Filter by media type')
  .option('--name <name>', 'Filter by name')
  .action(async (opts) => {
    try {
      print(
        await getClient().medias.list({
          page: opts.page,
          perPage: opts.perPage,
          projectId: opts.projectId,
          type: opts.type,
          name: opts.name,
        }),
        getFormat(mediasCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediasCmd.command('get <hashedId>').action(async (hashedId: string) => {
  try {
    print(await getClient().medias.get(hashedId), getFormat(mediasCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

mediasCmd
  .command('update <hashedId>')
  .requiredOption('--data <json>', 'JSON update payload')
  .action(async (hashedId: string, opts) => {
    try {
      print(await getClient().medias.update(hashedId, parseJsonOption(opts.data)!), getFormat(mediasCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediasCmd.command('delete <hashedId>').action(async (hashedId: string) => {
  try {
    await getClient().medias.delete(hashedId);
    success('Media deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

mediasCmd
  .command('copy <hashedId>')
  .option('--project-id <id>', 'Destination project')
  .option('--owner-email <email>', 'Owner email')
  .action(async (hashedId: string, opts) => {
    try {
      print(
        await getClient().medias.copy(hashedId, {
          projectId: opts.projectId,
          ownerEmail: opts.ownerEmail,
        }),
        getFormat(mediasCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediasCmd.command('stats <hashedId>').action(async (hashedId: string) => {
  try {
    print(await getClient().medias.getStats(hashedId), getFormat(mediasCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

mediasCmd.command('customizations <hashedId>').action(async (hashedId: string) => {
  try {
    print(await getClient().medias.getCustomizations(hashedId), getFormat(mediasCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

mediasCmd
  .command('update-customizations <hashedId>')
  .requiredOption('--data <json>', 'JSON customizations payload')
  .action(async (hashedId: string, opts) => {
    try {
      print(
        await getClient().medias.updateCustomizations(hashedId, parseJsonOption(opts.data)!),
        getFormat(mediasCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediasCmd.command('interactive <hashedId>').action(async (hashedId: string) => {
  try {
    print(await getClient().medias.listInteractive(hashedId), getFormat(mediasCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const captionsCmd = program.command('captions').description('Caption commands');

captionsCmd.command('list <mediaHashedId>').action(async (mediaHashedId: string) => {
  try {
    print(await getClient().captions.list(mediaHashedId), getFormat(captionsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

captionsCmd.command('get <mediaHashedId> <languageCode>').action(async (mediaHashedId: string, languageCode: string) => {
  try {
    print(await getClient().captions.get(mediaHashedId, languageCode), getFormat(captionsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

captionsCmd
  .command('create <mediaHashedId>')
  .requiredOption('-l, --language <code>', 'Language code')
  .option('--caption-file-url <url>', 'Caption file URL')
  .option('--draft', 'Save as draft')
  .action(async (mediaHashedId: string, opts) => {
    try {
      print(
        await getClient().captions.create(mediaHashedId, {
          languageCode: opts.language,
          captionFileUrl: opts.captionFileUrl,
          isDraft: opts.draft,
        }),
        getFormat(captionsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

captionsCmd.command('delete <mediaHashedId> <languageCode>').action(async (mediaHashedId: string, languageCode: string) => {
  try {
    await getClient().captions.delete(mediaHashedId, languageCode);
    success('Caption deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

captionsCmd.command('purchase <mediaHashedId>').action(async (mediaHashedId: string) => {
  try {
    print(await getClient().captions.purchase(mediaHashedId), getFormat(captionsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const channelsCmd = program.command('channels').description('Channel commands');

channelsCmd
  .command('list')
  .option('--page <n>', 'Page number', parseInt)
  .option('--per-page <n>', 'Results per page', parseInt)
  .action(async (opts) => {
    try {
      print(await getClient().channels.list({ page: opts.page, perPage: opts.perPage }), getFormat(channelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelsCmd.command('get <hashedId>').action(async (hashedId: string) => {
  try {
    print(await getClient().channels.get(hashedId), getFormat(channelsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

channelsCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Channel name')
  .option('--description <text>', 'Channel description')
  .action(async (opts) => {
    try {
      print(await getClient().channels.create({ name: opts.name, description: opts.description }), getFormat(channelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelsCmd
  .command('update <hashedId>')
  .requiredOption('--data <json>', 'JSON update payload')
  .action(async (hashedId: string, opts) => {
    try {
      print(await getClient().channels.update(hashedId, parseJsonOption(opts.data)!), getFormat(channelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelsCmd.command('delete <hashedId>').action(async (hashedId: string) => {
  try {
    await getClient().channels.delete(hashedId);
    success('Channel deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const statsCmd = program.command('stats').description('Analytics commands');

statsCmd
  .command('visitors')
  .option('--start-date <date>', 'Start date (YYYY-MM-DD)')
  .option('--end-date <date>', 'End date (YYYY-MM-DD)')
  .option('--page <n>', 'Page number', parseInt)
  .option('--per-page <n>', 'Results per page', parseInt)
  .action(async (opts) => {
    try {
      print(
        await getClient().stats.listVisitors({
          startDate: opts.startDate,
          endDate: opts.endDate,
          page: opts.page,
          perPage: opts.perPage,
        }),
        getFormat(statsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

statsCmd
  .command('events')
  .option('--media-id <id>', 'Filter by media')
  .option('--visitor-key <key>', 'Filter by visitor')
  .option('--start-date <date>', 'Start date')
  .option('--end-date <date>', 'End date')
  .action(async (opts) => {
    try {
      print(
        await getClient().stats.listEvents({
          mediaId: opts.mediaId,
          visitorKey: opts.visitorKey,
          startDate: opts.startDate,
          endDate: opts.endDate,
        }),
        getFormat(statsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

statsCmd
  .command('engagement <hashedId>')
  .option('--start-date <date>', 'Start date')
  .option('--end-date <date>', 'End date')
  .action(async (hashedId: string, opts) => {
    try {
      print(
        await getClient().stats.listMediaEngagement(hashedId, {
          startDate: opts.startDate,
          endDate: opts.endDate,
        }),
        getFormat(statsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const sharingsCmd = program.command('sharings').description('Project sharing commands');

sharingsCmd.command('list <projectId>').action(async (projectId: string) => {
  try {
    print(await getClient().sharings.listProjectSharings(projectId), getFormat(sharingsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

sharingsCmd
  .command('create <projectId>')
  .requiredOption('-e, --email <email>', 'Collaborator email')
  .option('--permission <level>', 'read_only, write, or owner', 'read_only')
  .action(async (projectId: string, opts) => {
    try {
      print(
        await getClient().sharings.createProjectSharing(projectId, {
          email: opts.email,
          permission: opts.permission,
        }),
        getFormat(sharingsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sharingsCmd.command('delete <projectId> <sharingId>').action(async (projectId: string, sharingId: string) => {
  try {
    await getClient().sharings.deleteProjectSharing(projectId, sharingId);
    success('Sharing removed');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.parse();
