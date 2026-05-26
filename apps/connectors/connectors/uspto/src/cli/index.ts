#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { USPTO } from '../api';
import {
  getApiKey,
  setApiKey,
  getHeadless,
  setHeadless,
  getBrowser,
  setBrowser,
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

const CONNECTOR_NAME = 'connect-uspto';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('USPTO API connector - Patent and trademark search with browser automation')
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
      process.env.USPTO_API_KEY = opts.apiKey;
    }
  });

function getRootFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

function getClient(): USPTO {
  const apiKey = getApiKey();
  const headless = getHeadless();
  const browser = getBrowser();
  return new USPTO({ apiKey, headless, browser });
}

// ============================================
// Patent Commands
// ============================================
const patentCmd = program
  .command('patent')
  .description('Patent operations');

patentCmd
  .command('search <query>')
  .description('Search patents')
  .option('-n, --rows <number>', 'Number of results', '25')
  .option('-s, --start <number>', 'Start offset', '0')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.patents.search({
        query,
        rows: parseInt(opts.rows),
        start: parseInt(opts.start),
      });

      success(`Found ${result.total} patents (showing ${result.patents.length})`);
      print(result.patents, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

patentCmd
  .command('get <patentNumber>')
  .description('Get patent by number')
  .action(async (patentNumber: string) => {
    try {
      const client = getClient();
      const patent = await client.patents.getByNumber(patentNumber);

      if (patent) {
        success(`Patent ${patent.patentNumber}`);
        print(patent, getRootFormat());
      } else {
        error('Patent not found');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

patentCmd
  .command('file-wrapper <applicationNumber>')
  .description('Get patent file wrapper (prosecution history)')
  .action(async (applicationNumber: string) => {
    try {
      const client = getClient();
      const wrapper = await client.patents.getFileWrapper(applicationNumber);

      if (wrapper) {
        success(`File wrapper for application ${wrapper.applicationNumber}`);
        print(wrapper, getRootFormat());
      } else {
        error('File wrapper not found');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

patentCmd
  .command('documents <applicationNumber>')
  .description('List documents for a patent application')
  .action(async (applicationNumber: string) => {
    try {
      const client = getClient();
      const documents = await client.patents.getDocuments(applicationNumber);

      if (documents.length > 0) {
        success(`Found ${documents.length} documents`);
        print(documents, getRootFormat());
      } else {
        info('No documents found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

patentCmd
  .command('assignments <patentNumber>')
  .description('Get patent assignments')
  .action(async (patentNumber: string) => {
    try {
      const client = getClient();
      const assignments = await client.patents.searchAssignments({ patentNumber });

      if (assignments.length > 0) {
        success(`Found ${assignments.length} assignments`);
        print(assignments, getRootFormat());
      } else {
        info('No assignments found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

patentCmd
  .command('claims <patentNumber>')
  .description('Get patent claims')
  .action(async (patentNumber: string) => {
    try {
      const client = getClient();
      const claims = await client.patents.getClaims(patentNumber);

      if (claims.length > 0) {
        success(`Found ${claims.length} claims`);
        claims.forEach((claim, i) => {
          console.log(chalk.bold(`\nClaim ${i + 1}:`));
          console.log(claim);
        });
      } else {
        info('No claims found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Trademark Commands
// ============================================
const trademarkCmd = program
  .command('trademark')
  .description('Trademark operations');

trademarkCmd
  .command('search <query>')
  .description('Search trademarks')
  .option('-n, --rows <number>', 'Number of results', '25')
  .option('-s, --start <number>', 'Start offset', '0')
  .option('--status <status>', 'Filter by status (live, dead, all)', 'all')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.trademarks.search({
        query,
        rows: parseInt(opts.rows),
        start: parseInt(opts.start),
        status: opts.status as 'live' | 'dead' | 'all',
      });

      success(`Found ${result.total} trademarks (showing ${result.trademarks.length})`);
      print(result.trademarks, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trademarkCmd
  .command('get <serialNumber>')
  .description('Get trademark by serial number')
  .action(async (serialNumber: string) => {
    try {
      const client = getClient();
      const trademark = await client.trademarks.getBySerialNumber(serialNumber);

      if (trademark) {
        success(`Trademark ${trademark.serialNumber}`);
        print(trademark, getRootFormat());
      } else {
        error('Trademark not found');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trademarkCmd
  .command('status <serialNumber>')
  .description('Get TSDR status for a trademark')
  .action(async (serialNumber: string) => {
    try {
      const client = getClient();
      const status = await client.trademarks.getTSDRStatus(serialNumber);

      if (status) {
        success(`Status for ${status.serialNumber}: ${status.status}`);
        print(status, getRootFormat());
      } else {
        error('Status not found');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trademarkCmd
  .command('documents <serialNumber>')
  .description('List documents for a trademark')
  .action(async (serialNumber: string) => {
    try {
      const client = getClient();
      const documents = await client.trademarks.getDocuments(serialNumber);

      if (documents.length > 0) {
        success(`Found ${documents.length} documents`);
        print(documents, getRootFormat());
      } else {
        info('No documents found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trademarkCmd
  .command('assignments <serialNumber>')
  .description('Get trademark assignments')
  .action(async (serialNumber: string) => {
    try {
      const client = getClient();
      const assignments = await client.trademarks.searchAssignments({ serialNumber });

      if (assignments.length > 0) {
        success(`Found ${assignments.length} assignments`);
        print(assignments, getRootFormat());
      } else {
        info('No assignments found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trademarkCmd
  .command('check <mark>')
  .description('Check trademark availability')
  .action(async (mark: string) => {
    try {
      const client = getClient();
      const result = await client.trademarks.checkAvailability(mark);

      if (result.available) {
        success(`"${mark}" appears to be available!`);
        info('Note: This is a basic check. Consult a trademark attorney for comprehensive clearance.');
      } else {
        warn(`"${mark}" may conflict with ${result.conflicts.length} existing trademarks:`);
        print(result.conflicts, getRootFormat());
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// PTAB Commands
// ============================================
const ptabCmd = program
  .command('ptab')
  .description('Patent Trial and Appeal Board operations');

ptabCmd
  .command('search')
  .description('Search PTAB proceedings')
  .option('-q, --query <query>', 'Search query')
  .option('--patent <number>', 'Filter by patent number')
  .option('--petitioner <name>', 'Filter by petitioner')
  .option('--owner <name>', 'Filter by patent owner')
  .option('--type <type>', 'Proceeding type (IPR, PGR, CBM, APPEAL)')
  .option('-n, --rows <number>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.ptab.search({
        query: opts.query,
        patentNumber: opts.patent,
        petitioner: opts.petitioner,
        patentOwner: opts.owner,
        type: opts.type,
        rows: parseInt(opts.rows),
      });

      success(`Found ${result.total} proceedings (showing ${result.proceedings.length})`);
      print(result.proceedings, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ptabCmd
  .command('get <proceedingNumber>')
  .description('Get PTAB proceeding by number')
  .action(async (proceedingNumber: string) => {
    try {
      const client = getClient();
      const proceeding = await client.ptab.getByNumber(proceedingNumber);

      if (proceeding) {
        success(`Proceeding ${proceeding.proceedingNumber}`);
        print(proceeding, getRootFormat());
      } else {
        error('Proceeding not found');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ptabCmd
  .command('for-patent <patentNumber>')
  .description('Get PTAB proceedings for a patent')
  .action(async (patentNumber: string) => {
    try {
      const client = getClient();
      const proceedings = await client.ptab.getForPatent(patentNumber);

      if (proceedings.length > 0) {
        success(`Found ${proceedings.length} proceedings`);
        print(proceedings, getRootFormat());
      } else {
        info('No PTAB proceedings found for this patent');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ptabCmd
  .command('documents <proceedingNumber>')
  .description('List documents for a PTAB proceeding')
  .action(async (proceedingNumber: string) => {
    try {
      const client = getClient();
      const documents = await client.ptab.getDocuments(proceedingNumber);

      if (documents.length > 0) {
        success(`Found ${documents.length} documents`);
        print(documents, getRootFormat());
      } else {
        info('No documents found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Browser Commands (Playwright)
// ============================================
const browserCmd = program
  .command('browser')
  .description('Browser automation commands (Playwright)');

browserCmd
  .command('tess <searchTerm>')
  .description('Search TESS (Trademark Electronic Search System)')
  .option('--type <type>', 'Search type (basic, word-and-or, structured, free-form)', 'basic')
  .option('--plurals', 'Search plurals')
  .option('--screenshot <path>', 'Save screenshot to file')
  .action(async (searchTerm: string, opts) => {
    const client = getClient();
    try {
      info('Launching browser to search TESS...');
      const results = await client.browser.searchTESS({
        searchTerm,
        searchType: opts.type,
        plurals: opts.plurals,
      }, {
        screenshotPath: opts.screenshot,
      });

      if (results.length > 0) {
        success(`Found ${results.length} results`);
        print(results, getRootFormat());
      } else {
        info('No results found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    } finally {
      await client.close();
    }
  });

browserCmd
  .command('patent-search <query>')
  .description('Search patents using USPTO website')
  .option('--screenshot <path>', 'Save screenshot to file')
  .action(async (query: string, opts) => {
    const client = getClient();
    try {
      info('Launching browser to search patents...');
      const results = await client.browser.searchPatents(query, {
        screenshotPath: opts.screenshot,
      });

      if (results.length > 0) {
        success(`Found ${results.length} results`);
        print(results, getRootFormat());
      } else {
        info('No results found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    } finally {
      await client.close();
    }
  });

browserCmd
  .command('download-patent <patentNumber> <outputPath>')
  .description('Download patent PDF')
  .action(async (patentNumber: string, outputPath: string) => {
    const client = getClient();
    try {
      info(`Downloading patent ${patentNumber}...`);
      const downloaded = await client.browser.downloadPatentPDF(patentNumber, outputPath);

      if (downloaded) {
        success(`Patent saved to ${outputPath}`);
      } else {
        error('Failed to download patent');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    } finally {
      await client.close();
    }
  });

browserCmd
  .command('download-trademark-image <serialNumber> <outputPath>')
  .description('Download trademark image')
  .action(async (serialNumber: string, outputPath: string) => {
    const client = getClient();
    try {
      info(`Downloading trademark image for ${serialNumber}...`);
      const downloaded = await client.browser.getTrademarkImage(serialNumber, outputPath);

      if (downloaded) {
        success(`Image saved to ${outputPath}`);
      } else {
        error('Failed to download trademark image');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    } finally {
      await client.close();
    }
  });

browserCmd
  .command('check-trademark <mark>')
  .description('Check trademark availability using TESS browser automation')
  .action(async (mark: string) => {
    const client = getClient();
    try {
      info(`Checking trademark availability for "${mark}"...`);
      const result = await client.browser.checkTrademarkAvailability(mark);

      if (result.available) {
        success(`"${mark}" appears to be available!`);
        info('Note: This is based on TESS search. Consult a trademark attorney for comprehensive clearance.');
      } else {
        warn(`"${mark}" may conflict with ${result.conflicts.length} existing trademarks:`);
        print(result.conflicts, getRootFormat());
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    } finally {
      await client.close();
    }
  });

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
    info(`Headless: ${config.headless !== false ? 'true' : 'false'}`);
    info(`Browser: ${config.browser || chalk.gray('chromium (default)')}`);
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
  .command('set-headless <value>')
  .description('Set headless mode (true/false)')
  .action((value: string) => {
    setHeadless(value === 'true');
    success(`Headless mode set to: ${value}`);
  });

configCmd
  .command('set-browser <browser>')
  .description('Set browser (chromium, firefox, webkit)')
  .action((browser: string) => {
    if (!['chromium', 'firefox', 'webkit'].includes(browser)) {
      error('Invalid browser. Choose: chromium, firefox, webkit');
      process.exit(1);
    }
    setBrowser(browser as 'chromium' | 'firefox' | 'webkit');
    success(`Browser set to: ${browser}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const headless = getHeadless();
    const browser = getBrowser();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set (most APIs work without key)')}`);
    info(`Headless: ${headless}`);
    info(`Browser: ${browser || 'chromium (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Parse and execute
program.parse();
