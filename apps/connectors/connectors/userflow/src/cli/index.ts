#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Userflow } from '../api';
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-userflow';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Userflow connector CLI - product onboarding, users, flows, surveys, webhooks')
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
      process.env.USERFLOW_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Userflow {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set USERFLOW_API_KEY.`);
    process.exit(1);
  }
  return new Userflow({ apiKey });
}

function parseJson(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function cursorOptions(cmd: Command): {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
} {
  const opts = cmd.opts();
  return {
    limit: opts.limit !== undefined ? Number(opts.limit) : undefined,
    starting_after: opts.startingAfter,
    ending_before: opts.endingBefore,
  };
}

function addCursorOptions(command: Command): Command {
  return command
    .option('--limit <n>', 'Page size')
    .option('--starting-after <cursor>', 'Cursor for forward pagination')
    .option('--ending-before <cursor>', 'Cursor for backward pagination');
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
  for (const p of profiles) {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  }
});

profileCmd
  .command('use <name>')
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
  .option('--api-key <key>', 'Userflow API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
    if (opts.use) setCurrentProfile(name);
    success(`Created profile: ${name}`);
  });

profileCmd.command('delete <name>').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Deleted profile: ${name}`);
});

// Config commands
const configCmd = program.command('config').description('Manage API configuration');

configCmd
  .command('set-key <key>')
  .description('Set API key for current profile')
  .action((key: string) => {
    setApiKey(key);
    success('API key saved');
  });

configCmd.command('show').action(() => {
  const apiKey = getApiKey();
  info(`Profile: ${getCurrentProfile()}`);
  info(`Config dir: ${getConfigDir()}`);
  info(`API key: ${apiKey ? `${apiKey.slice(0, 6)}...` : 'not set'}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success('Configuration cleared');
});

// Users
const usersCmd = program.command('users').description('User operations');

usersCmd
  .command('upsert')
  .requiredOption('--id <id>', 'User ID')
  .option('--attributes <json>', 'User attributes JSON')
  .option('--group-id <id>', 'Group ID')
  .option('--group-attributes <json>', 'Group attributes JSON')
  .option('--replace-attributes', 'Replace attributes instead of merging')
  .option('--signed <payload>', 'Signed payload')
  .action(async (opts, cmd) => {
    const result = await getClient().users.upsertUser({
      id: opts.id,
      attributes: parseJson(opts.attributes, 'attributes'),
      group_id: opts.groupId,
      group_attributes: parseJson(opts.groupAttributes, 'group-attributes'),
      replace_attributes: opts.replaceAttributes,
      signed: opts.signed,
    });
    print(result, getFormat(cmd));
  });

addCursorOptions(usersCmd.command('list').option('--q <query>', 'Search query')).action(async (opts, cmd) => {
  const result = await getClient().users.listUsers({
    ...cursorOptions(cmd),
    q: opts.q,
  });
  print(result, getFormat(cmd));
});

usersCmd.command('get <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().users.getUser(id), getFormat(cmd));
});

usersCmd.command('delete <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().users.deleteUser(id), getFormat(cmd));
});

usersCmd
  .command('add-to-group')
  .requiredOption('--user-id <id>', 'User ID')
  .requiredOption('--group-id <id>', 'Group ID')
  .option('--attributes <json>', 'Membership attributes JSON')
  .action(async (opts, cmd) => {
    const result = await getClient().users.addUserToGroup({
      user_id: opts.userId,
      group_id: opts.groupId,
      attributes: parseJson(opts.attributes, 'attributes'),
    });
    print(result, getFormat(cmd));
  });

// Groups
const groupsCmd = program.command('groups').description('Group operations');

groupsCmd
  .command('upsert')
  .requiredOption('--id <id>', 'Group ID')
  .option('--attributes <json>', 'Group attributes JSON')
  .option('--replace-attributes', 'Replace attributes')
  .action(async (opts, cmd) => {
    print(
      await getClient().groups.upsertGroup({
        id: opts.id,
        attributes: parseJson(opts.attributes, 'attributes'),
        replace_attributes: opts.replaceAttributes,
      }),
      getFormat(cmd),
    );
  });

addCursorOptions(groupsCmd.command('list')).action(async (_opts, cmd) => {
  print(await getClient().groups.listGroups(cursorOptions(cmd)), getFormat(cmd));
});

groupsCmd.command('get <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().groups.getGroup(id), getFormat(cmd));
});

groupsCmd.command('delete <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().groups.deleteGroup(id), getFormat(cmd));
});

// Events
const eventsCmd = program.command('events').description('Event tracking and definitions');

eventsCmd
  .command('track')
  .requiredOption('--user-id <id>', 'User ID')
  .requiredOption('--name <name>', 'Event name')
  .option('--attributes <json>', 'Event attributes JSON')
  .action(async (opts, cmd) => {
    print(
      await getClient().events.trackEvent({
        user_id: opts.userId,
        name: opts.name,
        attributes: parseJson(opts.attributes, 'attributes'),
      }),
      getFormat(cmd),
    );
  });

addCursorOptions(eventsCmd.command('list-definitions')).action(async (_opts, cmd) => {
  print(await getClient().events.listEvents(cursorOptions(cmd)), getFormat(cmd));
});

// Flows
const flowsCmd = program.command('flows').description('Flow operations');

addCursorOptions(flowsCmd.command('list').option('--state <state>', 'Flow state filter')).action(
  async (opts, cmd) => {
    print(
      await getClient().flows.listFlows({ ...cursorOptions(cmd), state: opts.state }),
      getFormat(cmd),
    );
  },
);

flowsCmd.command('get <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().flows.getFlow(id), getFormat(cmd));
});

flowsCmd
  .command('start')
  .requiredOption('--flow-id <id>', 'Flow ID')
  .requiredOption('--user-id <id>', 'User ID')
  .option('--idempotency-key <key>', 'Idempotency key')
  .action(async (opts, cmd) => {
    print(
      await getClient().flows.startFlowForUser({
        flow_id: opts.flowId,
        user_id: opts.userId,
        idempotency_key: opts.idempotencyKey,
      }),
      getFormat(cmd),
    );
  });

addCursorOptions(flowsCmd.command('progress <flowId>')).action(async (flowId: string, _opts, cmd) => {
  print(await getClient().flows.listFlowProgress(flowId, cursorOptions(cmd)), getFormat(cmd));
});

// Checklists
const checklistsCmd = program.command('checklists').description('Checklist operations');
addCursorOptions(checklistsCmd.command('list')).action(async (_opts, cmd) => {
  print(await getClient().checklists.listChecklists(cursorOptions(cmd)), getFormat(cmd));
});
checklistsCmd.command('get <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().checklists.getChecklist(id), getFormat(cmd));
});

// Resource centers
const rcCmd = program.command('resource-centers').description('Resource center operations');
addCursorOptions(rcCmd.command('list')).action(async (_opts, cmd) => {
  print(await getClient().resourceCenters.listResourceCenters(cursorOptions(cmd)), getFormat(cmd));
});
rcCmd.command('get <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().resourceCenters.getResourceCenter(id), getFormat(cmd));
});

// Surveys
const surveysCmd = program.command('surveys').description('Survey response operations');
addCursorOptions(
  surveysCmd
    .command('list-responses')
    .option('--flow-id <id>', 'Filter by flow ID')
    .option('--created-after <date>', 'Created after (ISO date)')
    .option('--created-before <date>', 'Created before (ISO date)'),
).action(async (opts, cmd) => {
  print(
    await getClient().surveys.listSurveyResponses({
      ...cursorOptions(cmd),
      flow_id: opts.flowId,
      created_after: opts.createdAfter,
      created_before: opts.createdBefore,
    }),
    getFormat(cmd),
  );
});
surveysCmd.command('get-response <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().surveys.getSurveyResponse(id), getFormat(cmd));
});

// Attributes
const attributesCmd = program.command('attributes').description('Attribute definitions');
addCursorOptions(attributesCmd.command('list').option('--entity <entity>', 'user or group')).action(
  async (opts, cmd) => {
    print(
      await getClient().attributes.listAttributes({
        ...cursorOptions(cmd),
        entity: opts.entity,
      }),
      getFormat(cmd),
    );
  },
);

// Segments
const segmentsCmd = program.command('segments').description('Segment operations');
addCursorOptions(segmentsCmd.command('list').option('--entity <entity>', 'user or group')).action(
  async (opts, cmd) => {
    print(
      await getClient().segments.listSegments({
        ...cursorOptions(cmd),
        entity: opts.entity,
      }),
      getFormat(cmd),
    );
  },
);
segmentsCmd.command('get <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().segments.getSegment(id), getFormat(cmd));
});
addCursorOptions(segmentsCmd.command('members <id>')).action(async (id: string, _opts, cmd) => {
  print(await getClient().segments.listSegmentMembers(id, cursorOptions(cmd)), getFormat(cmd));
});

// Launchers
const launchersCmd = program.command('launchers').description('Launcher operations');
addCursorOptions(launchersCmd.command('list')).action(async (_opts, cmd) => {
  print(await getClient().launchers.listLaunchers(cursorOptions(cmd)), getFormat(cmd));
});
launchersCmd.command('get <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().launchers.getLauncher(id), getFormat(cmd));
});

// Banners
const bannersCmd = program.command('banners').description('Banner operations');
addCursorOptions(bannersCmd.command('list')).action(async (_opts, cmd) => {
  print(await getClient().banners.listBanners(cursorOptions(cmd)), getFormat(cmd));
});
bannersCmd.command('get <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().banners.getBanner(id), getFormat(cmd));
});

// Features
const featuresCmd = program.command('features').description('Feature operations');
addCursorOptions(featuresCmd.command('list')).action(async (_opts, cmd) => {
  print(await getClient().features.listFeatures(cursorOptions(cmd)), getFormat(cmd));
});
featuresCmd.command('get <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().features.getFeature(id), getFormat(cmd));
});
featuresCmd
  .command('usage <id>')
  .option('--user-id <id>', 'Filter by user')
  .option('--group-id <id>', 'Filter by group')
  .option('--created-after <date>', 'Created after')
  .option('--created-before <date>', 'Created before')
  .action(async (id: string, opts, cmd) => {
    print(
      await getClient().features.getFeatureUsage(id, {
        user_id: opts.userId,
        group_id: opts.groupId,
        created_after: opts.createdAfter,
        created_before: opts.createdBefore,
      }),
      getFormat(cmd),
    );
  });

// Magic links
const magicLinksCmd = program.command('magic-links').description('Magic link operations');
magicLinksCmd
  .command('create')
  .requiredOption('--user-id <id>', 'User ID')
  .option('--expires-at <iso>', 'Expiration timestamp')
  .action(async (opts, cmd) => {
    print(
      await getClient().magicLinks.createMagicLink({
        user_id: opts.userId,
        expires_at: opts.expiresAt,
      }),
      getFormat(cmd),
    );
  });

// Signed data keys
const sdkCmd = program.command('signed-data-keys').description('Signed data key operations');
sdkCmd.command('list').action(async (_opts, cmd) => {
  print(await getClient().signedDataKeys.listSignedDataKeys(), getFormat(cmd));
});
sdkCmd
  .command('create')
  .requiredOption('--name <name>', 'Key name')
  .action(async (opts, cmd) => {
    print(await getClient().signedDataKeys.createSignedDataKey({ name: opts.name }), getFormat(cmd));
  });
sdkCmd.command('delete <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().signedDataKeys.deleteSignedDataKey(id), getFormat(cmd));
});

// Webhooks
const webhooksCmd = program.command('webhooks').description('Webhook endpoint operations');
webhooksCmd.command('list').action(async (_opts, cmd) => {
  print(await getClient().webhooks.listWebhookEndpoints(), getFormat(cmd));
});
webhooksCmd
  .command('create')
  .requiredOption('--url <url>', 'Webhook URL')
  .requiredOption('--enabled-events <events>', 'Comma-separated event names')
  .option('--description <text>', 'Description')
  .option('--disabled', 'Create disabled')
  .action(async (opts, cmd) => {
    print(
      await getClient().webhooks.createWebhookEndpoint({
        url: opts.url,
        enabled_events: opts.enabledEvents.split(',').map((e: string) => e.trim()),
        description: opts.description,
        disabled: opts.disabled,
      }),
      getFormat(cmd),
    );
  });
webhooksCmd
  .command('update <id>')
  .requiredOption('--data <json>', 'Update payload JSON')
  .action(async (id: string, opts, cmd) => {
    const data = parseJson(opts.data, 'data');
    if (!data) {
      error('--data is required');
      process.exit(1);
    }
    print(await getClient().webhooks.updateWebhookEndpoint(id, data), getFormat(cmd));
  });
webhooksCmd.command('delete <id>').action(async (id: string, _opts, cmd) => {
  print(await getClient().webhooks.deleteWebhookEndpoint(id), getFormat(cmd));
});

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  error(message);
  process.exit(1);
});
