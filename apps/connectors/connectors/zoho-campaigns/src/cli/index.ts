#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoCampaigns } from '../api';
import {
  getToken,
  setToken,
  getDataCenter,
  setDataCenter,
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
  getBaseUrl,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-zoho-campaigns';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Campaigns connector - Email marketing lists, subscribers, campaigns, and reports')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
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
    if (opts.token) {
      process.env.ZOHOCAMPAIGNS_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoCampaigns {
  const token = getToken();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHOCAMPAIGNS_TOKEN.`);
    process.exit(1);
  }
  return new ZohoCampaigns({ token, dataCenter: getDataCenter(), baseUrl: getBaseUrl() });
}

async function run<T>(cmd: Command, fn: () => Promise<T>): Promise<void> {
  try {
    const result = await fn();
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
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

profileCmd.command('create <name>').option('--token <token>', 'OAuth token').option('--use', 'Switch after creation').action((name: string, opts) => {
  if (profileExists(name)) {
    error(`Profile "${name}" already exists`);
    process.exit(1);
  }
  createProfile(name, { token: opts.token, dataCenter: getDataCenter() });
  success(`Profile "${name}" created`);
  if (opts.use) {
    setCurrentProfile(name);
    info(`Switched to profile: ${name}`);
  }
});

profileCmd.command('delete <name>').action((name: string) => {
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
    error(`Profile "${name}" not found or cannot be deleted`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}${profileName === getCurrentProfile() ? chalk.green(' (active)') : ''}`));
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
  success(`Data center saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').action(() => {
  const token = getToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Data center: ${getDataCenter() || chalk.gray('com (default)')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const listCmd = program.command('list').description('Mailing list operations');

listCmd.command('ls').option('--from <index>', 'Start index', '1').option('--range <n>', 'Page size', '50').action(async (opts) => {
  await run(listCmd, () => getClient().listMailingLists({ fromIndex: Number(opts.from), range: Number(opts.range) }));
});

listCmd.command('get <listKey>').action(async (listKey: string) => {
  await run(listCmd, () => getClient().getMailingListDetails(listKey));
});

listCmd.command('create').requiredOption('-n, --name <name>', 'List name').option('--signup <form>', 'public or private').action(async (opts) => {
  await run(listCmd, () => getClient().createMailingList({ listName: opts.name, signupForm: opts.signup }));
});

listCmd.command('update <listKey>').option('-n, --name <name>', 'List name').option('-d, --description <desc>', 'Description').action(async (listKey: string, opts) => {
  await run(listCmd, () => getClient().updateMailingList({ listKey, listName: opts.name, description: opts.description }));
});

const subscriberCmd = program.command('subscriber').description('Subscriber operations');

subscriberCmd.command('ls <listKey>').option('-s, --status <status>', 'active|recent|unsub|bounce').option('--from <index>', 'Start index', '1').option('--range <n>', 'Page size', '50').action(async (listKey: string, opts) => {
  await run(subscriberCmd, () => getClient().listSubscribers({ listKey, status: opts.status, fromIndex: Number(opts.from), range: Number(opts.range) }));
});

subscriberCmd.command('get <listKey> <email>').action(async (listKey: string, email: string) => {
  await run(subscriberCmd, () => getClient().getSubscriberDetails({ listKey, emailId: email }));
});

subscriberCmd.command('add <listKey>').requiredOption('-e, --email <email>', 'Email address').option('--first-name <name>', 'First name').option('--last-name <name>', 'Last name').action(async (listKey: string, opts) => {
  const contact: Record<string, unknown> = { 'Contact Email': opts.email };
  if (opts.firstName) contact['First Name'] = opts.firstName;
  if (opts.lastName) contact['Last Name'] = opts.lastName;
  await run(subscriberCmd, () => getClient().addSubscribers({ listKey, contactInfo: [contact] }));
});

subscriberCmd.command('bulk <listKey>').requiredOption('-e, --emails <emails>', 'Comma-separated emails').action(async (listKey: string, opts) => {
  await run(subscriberCmd, () => getClient().addSubscribersBulk({ listKey, emailIds: opts.emails.split(',').map((s: string) => s.trim()) }));
});

subscriberCmd.command('unsubscribe <listKey> <email>').action(async (listKey: string, email: string) => {
  await run(subscriberCmd, () => getClient().unsubscribeSubscriber({ listKey, contactInfo: { 'Contact Email': email } }));
});

subscriberCmd.command('remove <listKey> <email>').action(async (listKey: string, email: string) => {
  await run(subscriberCmd, () => getClient().removeSubscriber({ listKey, contactInfo: { 'Contact Email': email } }));
});

subscriberCmd.command('tag <email>').requiredOption('--tag <tag>', 'Tag name').action(async (email: string, opts) => {
  await run(subscriberCmd, () => getClient().tagSubscriber({ emailId: email, tag: opts.tag }));
});

const campaignCmd = program.command('campaign').description('Campaign operations');

campaignCmd.command('recent').option('--status <status>', 'all|drafts|schedules|active|stopped|recent').option('--from <index>', 'Start index', '1').option('--range <n>', 'Page size', '50').action(async (opts) => {
  await run(campaignCmd, () => getClient().listRecentCampaigns({ status: opts.status, fromIndex: Number(opts.from), range: Number(opts.range) }));
});

campaignCmd.command('ls').option('--status <status>', 'Campaign status filter').option('--from <index>', 'Start index', '1').option('--range <n>', 'Page size', '50').action(async (opts) => {
  await run(campaignCmd, () => getClient().listAllCampaigns({ status: opts.status, fromIndex: Number(opts.from), range: Number(opts.range) }));
});

campaignCmd.command('search <query>').action(async (query: string) => {
  await run(campaignCmd, () => getClient().searchCampaigns({ searchKey: query }));
});

campaignCmd.command('get <campaignKey>').action(async (campaignKey: string) => {
  await run(campaignCmd, () => getClient().getCampaignDetails(campaignKey));
});

campaignCmd.command('create').requiredOption('-n, --name <name>', 'Campaign name').requiredOption('--from <email>', 'From email').requiredOption('-s, --subject <subject>', 'Subject').option('--list <listKey>', 'Mailing list key').option('--html <html>', 'HTML content').action(async (opts) => {
  await run(campaignCmd, () =>
    getClient().createCampaign({
      campaignName: opts.name,
      fromEmail: opts.from,
      subject: opts.subject,
      listKey: opts.list,
      htmlContent: opts.html,
    }),
  );
});

campaignCmd.command('clone <campaignKey>').option('-n, --name <name>', 'New campaign name').action(async (campaignKey: string, opts) => {
  await run(campaignCmd, () => getClient().cloneCampaign({ campaignKey, campaignName: opts.name }));
});

campaignCmd.command('send <campaignKey>').action(async (campaignKey: string) => {
  await run(campaignCmd, async () => {
    const result = await getClient().sendCampaign(campaignKey);
    success(`Campaign ${campaignKey} send initiated`);
    return result;
  });
});

campaignCmd.command('test <campaignKey>').requiredOption('-e, --emails <emails>', 'Comma-separated test emails').action(async (campaignKey: string, opts) => {
  await run(campaignCmd, () => getClient().sendCampaignTestMail({ campaignKey, emailIds: opts.emails.split(',').map((s: string) => s.trim()) }));
});

campaignCmd.command('stop <campaignKey>').action(async (campaignKey: string) => {
  await run(campaignCmd, async () => {
    const result = await getClient().stopCampaign(campaignKey);
    success(`Campaign ${campaignKey} stopped`);
    return result;
  });
});

campaignCmd.command('delete <campaignKey>').action(async (campaignKey: string) => {
  await run(campaignCmd, async () => {
    const result = await getClient().deleteCampaign(campaignKey);
    success(`Campaign ${campaignKey} deleted`);
    return result;
  });
});

const reportCmd = program.command('report').description('Campaign report operations');

reportCmd.command('get <campaignKey>').action(async (campaignKey: string) => {
  await run(reportCmd, () => getClient().getCampaignReports(campaignKey));
});

reportCmd.command('summary <campaignKey>').action(async (campaignKey: string) => {
  await run(reportCmd, () => getClient().getCampaignSummary(campaignKey));
});

reportCmd.command('members <campaignKey>').option('-t, --type <type>', 'sent|delivered|opens|clicks|unopens|bounce|unsub').action(async (campaignKey: string, opts) => {
  await run(reportCmd, () => getClient().getCampaignMembers({ campaignKey, type: opts.type }));
});

reportCmd.command('clicks <campaignKey>').action(async (campaignKey: string) => {
  await run(reportCmd, () => getClient().getCampaignClickDetails(campaignKey));
});

const topicCmd = program.command('topic').description('Topic operations');
topicCmd.command('ls').action(async () => {
  await run(topicCmd, () => getClient().listTopics());
});

const segmentCmd = program.command('segment').description('Segment operations');
segmentCmd.command('ls').option('--from <index>', 'Start index', '1').option('--range <n>', 'Page size', '50').action(async (opts) => {
  await run(segmentCmd, () => getClient().listSegments({ fromIndex: Number(opts.from), range: Number(opts.range) }));
});

const fieldCmd = program.command('field').description('Custom field operations');
fieldCmd.command('ls').action(async () => {
  await run(fieldCmd, () => getClient().listCustomFields());
});

program.parse();
