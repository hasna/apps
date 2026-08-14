#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ContactOut } from '../api';
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
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-contactout';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('ContactOut API connector - Find emails, phone numbers, and enrich LinkedIn profiles')
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
      process.env.CONTACTOUT_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ContactOut {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set CONTACTOUT_API_KEY environment variable.`);
    process.exit(1);
  }
  return new ContactOut({ apiKey });
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

    createProfile(name, {
      apiKey: opts.apiKey,
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
// LinkedIn Commands
// ============================================
const linkedinCmd = program
  .command('linkedin')
  .description('LinkedIn profile enrichment and contact info');

linkedinCmd
  .command('enrich <url>')
  .description('Enrich a LinkedIn profile - get full profile data with contact info')
  .option('--profile-only', 'Return profile without contact info (saves credits)')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const result = await client.linkedin.enrich({
        profile: url,
        profile_only: opts.profileOnly,
      });
      print(result, getFormat(linkedinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

linkedinCmd
  .command('contact <url>')
  .description('Get contact info (emails/phones) for a LinkedIn profile')
  .option('--phone', 'Include phone numbers')
  .option('--email-type <type>', 'Email type: personal, work, personal,work, or none', 'personal,work')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const result = await client.linkedin.getContactInfo({
        profile: url,
        include_phone: opts.phone,
        email_type: opts.emailType,
      });
      print(result, getFormat(linkedinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

linkedinCmd
  .command('batch <urls...>')
  .description('Batch get contact info for multiple LinkedIn profiles (max 30)')
  .action(async (urls: string[]) => {
    try {
      const client = getClient();
      const result = await client.linkedin.batchContactInfo({ profiles: urls });
      print(result, getFormat(linkedinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

linkedinCmd
  .command('batch-async <urls...>')
  .description('Async batch get contact info (max 1000, returns job ID)')
  .option('--phone', 'Include phone numbers')
  .option('--callback <url>', 'Webhook URL for completion notification')
  .action(async (urls: string[], opts) => {
    try {
      const client = getClient();
      const result = await client.linkedin.batchContactInfoAsync({
        profiles: urls,
        include_phone: opts.phone,
        callback_url: opts.callback,
      });
      print(result, getFormat(linkedinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

linkedinCmd
  .command('job <jobId>')
  .description('Get batch job status and results')
  .action(async (jobId: string) => {
    try {
      const client = getClient();
      const result = await client.linkedin.getBatchJob(jobId);
      print(result, getFormat(linkedinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

linkedinCmd
  .command('check-email <url>')
  .description('Check if personal/work email is available (no credits)')
  .option('--work', 'Check work email instead of personal')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const result = opts.work
        ? await client.linkedin.checkWorkEmailStatus(url)
        : await client.linkedin.checkPersonalEmailStatus(url);
      print(result, getFormat(linkedinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

linkedinCmd
  .command('check-phone <url>')
  .description('Check if phone number is available (no credits)')
  .action(async (url: string) => {
    try {
      const client = getClient();
      const result = await client.linkedin.checkPhoneStatus(url);
      print(result, getFormat(linkedinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// People Commands
// ============================================
const peopleCmd = program
  .command('people')
  .description('People search and enrichment');

peopleCmd
  .command('search')
  .description('Search for people matching criteria')
  .option('--name <name>', 'Person name')
  .option('--title <titles...>', 'Job titles')
  .option('--company <companies...>', 'Company names')
  .option('--location <locations...>', 'Locations')
  .option('--industry <industries...>', 'Industries')
  .option('--skills <skills...>', 'Skills')
  .option('--seniority <levels...>', 'Seniority levels')
  .option('--page <number>', 'Page number', '1')
  .option('--reveal', 'Reveal contact info (consumes credits)')
  .option('--detailed', 'Include detailed experience/education')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.people.search({
        name: opts.name,
        job_title: opts.title,
        company: opts.company,
        location: opts.location,
        industry: opts.industry,
        skills: opts.skills,
        seniority: opts.seniority,
        page: parseInt(opts.page),
        reveal_info: opts.reveal,
        detailed_experience: opts.detailed,
        detailed_education: opts.detailed,
      });
      print(result, getFormat(peopleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

peopleCmd
  .command('count')
  .description('Count people matching criteria (no credits)')
  .option('--name <name>', 'Person name')
  .option('--title <titles...>', 'Job titles')
  .option('--company <companies...>', 'Company names')
  .option('--location <locations...>', 'Locations')
  .option('--industry <industries...>', 'Industries')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.people.count({
        name: opts.name,
        job_title: opts.title,
        company: opts.company,
        location: opts.location,
        industry: opts.industry,
      });
      print(result, getFormat(peopleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

peopleCmd
  .command('enrich')
  .description('Enrich a person using multiple identifying parameters')
  .option('--linkedin <url>', 'LinkedIn URL')
  .option('--email <email>', 'Email address')
  .option('--name <name>', 'Full name')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--company <company>', 'Company name')
  .option('--domain <domain>', 'Company domain')
  .option('--location <location>', 'Location')
  .option('--include <types...>', 'Include: work_email, personal_email, phone')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.people.enrich({
        linkedin_url: opts.linkedin,
        email: opts.email,
        full_name: opts.name,
        first_name: opts.firstName,
        last_name: opts.lastName,
        company: opts.company,
        company_domain: opts.domain,
        location: opts.location,
        include: opts.include,
      });
      print(result, getFormat(peopleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

peopleCmd
  .command('decision-makers')
  .description('Get decision makers at a company')
  .option('--linkedin <url>', 'Company LinkedIn URL')
  .option('--domain <domain>', 'Company domain')
  .option('--name <name>', 'Company name')
  .option('--page <number>', 'Page number', '1')
  .option('--reveal', 'Reveal contact info (consumes credits)')
  .action(async (opts) => {
    try {
      if (!opts.linkedin && !opts.domain && !opts.name) {
        error('At least one of --linkedin, --domain, or --name is required');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.people.getDecisionMakers({
        linkedin_url: opts.linkedin,
        domain: opts.domain,
        name: opts.name,
        page: parseInt(opts.page),
        reveal_info: opts.reveal,
      });
      print(result, getFormat(peopleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Company Commands
// ============================================
const companyCmd = program
  .command('company')
  .description('Company search and enrichment');

companyCmd
  .command('search')
  .description('Search for companies matching criteria')
  .option('--name <name>', 'Company name')
  .option('--domain <domain>', 'Company domain')
  .option('--size <sizes...>', 'Company sizes')
  .option('--location <locations...>', 'Locations')
  .option('--industry <industries...>', 'Industries')
  .option('--min-revenue <amount>', 'Minimum revenue')
  .option('--max-revenue <amount>', 'Maximum revenue')
  .option('--founded-from <year>', 'Founded after year')
  .option('--founded-to <year>', 'Founded before year')
  .option('--page <number>', 'Page number', '1')
  .option('--hq-only', 'Only return HQ locations')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.company.search({
        name: opts.name,
        domain: opts.domain,
        size: opts.size,
        location: opts.location,
        industry: opts.industry,
        min_revenue: opts.minRevenue ? parseInt(opts.minRevenue) : undefined,
        max_revenue: opts.maxRevenue ? parseInt(opts.maxRevenue) : undefined,
        year_founded_from: opts.foundedFrom ? parseInt(opts.foundedFrom) : undefined,
        year_founded_to: opts.foundedTo ? parseInt(opts.foundedTo) : undefined,
        page: parseInt(opts.page),
        hq_only: opts.hqOnly,
      });
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companyCmd
  .command('domain <domains...>')
  .description('Get company info from domains (no credits, max 30)')
  .action(async (domains: string[]) => {
    try {
      const client = getClient();
      const result = await client.company.enrichFromDomains({ domains });
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Email Commands
// ============================================
const emailCmd = program
  .command('email')
  .description('Email enrichment and verification');

emailCmd
  .command('enrich <email>')
  .description('Enrich profile from email address')
  .option('--include <type>', 'Include work_email in response')
  .action(async (email: string, opts) => {
    try {
      const client = getClient();
      const result = await client.email.enrich({
        email,
        include: opts.include,
      });
      print(result, getFormat(emailCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

emailCmd
  .command('verify <email>')
  .description('Verify an email address')
  .action(async (email: string) => {
    try {
      const client = getClient();
      const result = await client.email.verify(email);
      print(result, getFormat(emailCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

emailCmd
  .command('verify-batch <emails...>')
  .description('Batch verify emails (max 1000, returns job ID)')
  .option('--callback <url>', 'Webhook URL for completion notification')
  .action(async (emails: string[], opts) => {
    try {
      const client = getClient();
      const result = await client.email.batchVerify({
        emails,
        callback_url: opts.callback,
      });
      print(result, getFormat(emailCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

emailCmd
  .command('verify-job <jobId>')
  .description('Get batch verification job status and results')
  .action(async (jobId: string) => {
    try {
      const client = getClient();
      const result = await client.email.getBatchVerifyJob(jobId);
      print(result, getFormat(emailCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

emailCmd
  .command('to-linkedin <email>')
  .description('Find LinkedIn profile URL from email')
  .action(async (email: string) => {
    try {
      const client = getClient();
      const result = await client.email.toLinkedIn(email);
      print(result, getFormat(emailCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Stats Commands
// ============================================
const statsCmd = program
  .command('stats')
  .description('API usage statistics');

statsCmd
  .command('show')
  .description('Show API usage statistics')
  .option('--period <period>', 'Period in YYYY-MM format')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.stats.get({ period: opts.period });
      print(result, getFormat(statsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

statsCmd
  .command('current')
  .description('Show current month usage')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.stats.getCurrentMonth();
      print(result, getFormat(statsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
