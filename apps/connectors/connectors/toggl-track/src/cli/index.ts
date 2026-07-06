#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TogglTrack } from '../api';
import {
  getApiToken,
  setApiToken,
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

const CONNECTOR_NAME = 'connect-toggl-track';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Toggl Track connector CLI — workspaces, projects, time entries, and more')
  .version(VERSION)
  .option('-k, --api-token <token>', 'API token (overrides profile)')
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
    if (opts.apiToken) {
      process.env.TOGGL_TRACK_API_TOKEN = opts.apiToken;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TogglTrack {
  const apiToken = getApiToken();
  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set TOGGL_TRACK_API_TOKEN.`);
    process.exit(1);
  }
  return new TogglTrack({ apiToken });
}

function parseWorkspaceId(value: string): number {
  const id = Number(value);
  if (!Number.isFinite(id)) {
    error('Workspace ID must be a number');
    process.exit(1);
  }
  return id;
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
  .option('--api-token <token>', 'API token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiToken: opts.apiToken });
    success(`Profile "${name}" created`);
    if (opts.use) setCurrentProfile(name);
  });

profileCmd.command('delete <name>').action((name: string) => {
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

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  const token = config.apiToken || config.apiKey || config.token;
  info(`API Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').action((token: string) => {
  setApiToken(token);
  success(`API token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').action(() => {
  const token = getApiToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

program.command('me').description('Get current user').action(async () => {
  try {
    const client = getClient();
    print(await client.me.getCurrentUser(), getFormat(program));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const workspacesCmd = program.command('workspaces').description('Workspace operations');

workspacesCmd.command('list').description('List my workspaces').action(async () => {
  try {
    print(await getClient().me.listMyWorkspaces(), getFormat(workspacesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

workspacesCmd.command('get <workspaceId>').action(async (workspaceId: string) => {
  try {
    print(await getClient().workspaces.get(parseWorkspaceId(workspaceId)), getFormat(workspacesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const projectsCmd = program.command('projects').description('Project operations');

projectsCmd
  .command('list <workspaceId>')
  .option('--name <name>', 'Filter by name')
  .option('--active <value>', 'active filter: true|false|both')
  .action(async (workspaceId: string, opts) => {
    try {
      const active = opts.active as 'true' | 'false' | 'both' | undefined;
      print(
        await getClient().projects.list(parseWorkspaceId(workspaceId), {
          name: opts.name,
          active,
        }),
        getFormat(projectsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd.command('my').option('--include-archived', 'Include archived projects').action(async (opts) => {
  try {
    print(await getClient().me.listMyProjects({ includeArchived: opts.includeArchived }), getFormat(projectsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

projectsCmd.command('get <workspaceId> <projectId>').action(async (workspaceId: string, projectId: string) => {
  try {
    print(
      await getClient().projects.get(parseWorkspaceId(workspaceId), Number(projectId)),
      getFormat(projectsCmd),
    );
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

projectsCmd
  .command('create <workspaceId>')
  .requiredOption('-n, --name <name>', 'Project name')
  .option('--client-id <id>', 'Client ID')
  .option('--billable', 'Billable project')
  .action(async (workspaceId: string, opts) => {
    try {
      const result = await getClient().projects.create(parseWorkspaceId(workspaceId), {
        name: opts.name,
        client_id: opts.clientId ? Number(opts.clientId) : undefined,
        billable: opts.billable || undefined,
      });
      success('Project created');
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('update <workspaceId> <projectId>')
  .option('-n, --name <name>', 'Project name')
  .option('--active <value>', 'true or false')
  .action(async (workspaceId: string, projectId: string, opts) => {
    try {
      print(
        await getClient().projects.update(parseWorkspaceId(workspaceId), Number(projectId), {
          name: opts.name,
          active: opts.active !== undefined ? opts.active === 'true' : undefined,
        }),
        getFormat(projectsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd.command('delete <workspaceId> <projectId>').action(async (workspaceId: string, projectId: string) => {
  try {
    await getClient().projects.delete(parseWorkspaceId(workspaceId), Number(projectId));
    success('Project deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const clientsCmd = program.command('clients').description('Client operations');

clientsCmd.command('list <workspaceId>').action(async (workspaceId: string) => {
  try {
    print(await getClient().clients.list(parseWorkspaceId(workspaceId)), getFormat(clientsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

clientsCmd.command('my').action(async () => {
  try {
    print(await getClient().me.listMyClients(), getFormat(clientsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

clientsCmd
  .command('create <workspaceId>')
  .requiredOption('-n, --name <name>', 'Client name')
  .action(async (workspaceId: string, opts) => {
    try {
      const result = await getClient().clients.create(parseWorkspaceId(workspaceId), { name: opts.name });
      success('Client created');
      print(result, getFormat(clientsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

clientsCmd
  .command('update <workspaceId> <clientId>')
  .option('-n, --name <name>', 'Client name')
  .option('--archived', 'Archive client')
  .action(async (workspaceId: string, clientId: string, opts) => {
    try {
      print(
        await getClient().clients.update(parseWorkspaceId(workspaceId), Number(clientId), {
          name: opts.name,
          archived: opts.archived || undefined,
        }),
        getFormat(clientsCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

clientsCmd.command('delete <workspaceId> <clientId>').action(async (workspaceId: string, clientId: string) => {
  try {
    await getClient().clients.delete(parseWorkspaceId(workspaceId), Number(clientId));
    success('Client deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const tagsCmd = program.command('tags').description('Tag operations');

tagsCmd.command('list <workspaceId>').action(async (workspaceId: string) => {
  try {
    print(await getClient().tags.list(parseWorkspaceId(workspaceId)), getFormat(tagsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

tagsCmd
  .command('create <workspaceId>')
  .requiredOption('-n, --name <name>', 'Tag name')
  .action(async (workspaceId: string, opts) => {
    try {
      print(await getClient().tags.create(parseWorkspaceId(workspaceId), opts.name), getFormat(tagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagsCmd.command('delete <workspaceId> <tagId>').action(async (workspaceId: string, tagId: string) => {
  try {
    await getClient().tags.delete(parseWorkspaceId(workspaceId), Number(tagId));
    success('Tag deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const tasksCmd = program.command('tasks').description('Task operations');

tasksCmd
  .command('list <workspaceId>')
  .option('--project-id <id>', 'Filter by project')
  .action(async (workspaceId: string, opts) => {
    try {
      print(
        await getClient().tasks.list(parseWorkspaceId(workspaceId), {
          projectId: opts.projectId ? Number(opts.projectId) : undefined,
        }),
        getFormat(tasksCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('create <workspaceId> <projectId>')
  .requiredOption('-n, --name <name>', 'Task name')
  .action(async (workspaceId: string, projectId: string, opts) => {
    try {
      print(
        await getClient().tasks.create(parseWorkspaceId(workspaceId), Number(projectId), { name: opts.name }),
        getFormat(tasksCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const timeCmd = program.command('time-entries').description('Time entry operations');

timeCmd
  .command('list')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      print(
        await getClient().timeEntries.list({ startDate: opts.start, endDate: opts.end }),
        getFormat(timeCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

timeCmd.command('current').action(async () => {
  try {
    print(await getClient().timeEntries.getCurrent(), getFormat(timeCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

timeCmd.command('get <workspaceId> <entryId>').action(async (workspaceId: string, entryId: string) => {
  try {
    print(
      await getClient().timeEntries.get(parseWorkspaceId(workspaceId), Number(entryId)),
      getFormat(timeCmd),
    );
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

timeCmd
  .command('create <workspaceId>')
  .requiredOption('--start <iso>', 'Start time (ISO 8601)')
  .requiredOption('--created-with <name>', 'Created-with client name')
  .option('-d, --description <text>', 'Description')
  .option('--project-id <id>', 'Project ID')
  .option('--duration <seconds>', 'Duration in seconds')
  .action(async (workspaceId: string, opts) => {
    try {
      print(
        await getClient().timeEntries.create(parseWorkspaceId(workspaceId), {
          start: opts.start,
          created_with: opts.createdWith,
          description: opts.description,
          project_id: opts.projectId ? Number(opts.projectId) : undefined,
          duration: opts.duration ? Number(opts.duration) : undefined,
        }),
        getFormat(timeCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

timeCmd
  .command('update <workspaceId> <entryId>')
  .option('-d, --description <text>', 'Description')
  .option('--stop <iso>', 'Stop time (ISO 8601)')
  .action(async (workspaceId: string, entryId: string, opts) => {
    try {
      print(
        await getClient().timeEntries.update(parseWorkspaceId(workspaceId), Number(entryId), {
          description: opts.description,
          stop: opts.stop,
        }),
        getFormat(timeCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

timeCmd.command('stop <workspaceId> <entryId>').action(async (workspaceId: string, entryId: string) => {
  try {
    print(
      await getClient().timeEntries.stop(parseWorkspaceId(workspaceId), Number(entryId)),
      getFormat(timeCmd),
    );
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

timeCmd.command('delete <workspaceId> <entryId>').action(async (workspaceId: string, entryId: string) => {
  try {
    await getClient().timeEntries.delete(parseWorkspaceId(workspaceId), Number(entryId));
    success('Time entry deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const usersCmd = program.command('users').description('Workspace user operations');

usersCmd.command('list <workspaceId>').action(async (workspaceId: string) => {
  try {
    print(await getClient().users.listWorkspaceUsers(parseWorkspaceId(workspaceId)), getFormat(usersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

usersCmd.command('groups <workspaceId>').action(async (workspaceId: string) => {
  try {
    print(await getClient().users.listGroups(parseWorkspaceId(workspaceId)), getFormat(usersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

usersCmd.command('project <workspaceId> <projectId>').action(async (workspaceId: string, projectId: string) => {
  try {
    print(
      await getClient().users.listProjectUsers(parseWorkspaceId(workspaceId), Number(projectId)),
      getFormat(usersCmd),
    );
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.command('organizations').description('List my organizations').action(async () => {
  try {
    print(await getClient().me.listOrganizations(), getFormat(program));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.command('features').description('Get enabled features for current user').action(async () => {
  try {
    print(await getClient().me.getFeatures(), getFormat(program));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.parse();
