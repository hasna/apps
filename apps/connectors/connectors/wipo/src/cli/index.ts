#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { WIPO } from '../api';
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

const CONNECTOR_NAME = 'connect-wipo';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('WIPO API connector - Patentscope, Madrid trademark system, WIPO Pearl terminology')
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
      process.env.WIPO_API_KEY = opts.apiKey;
    }
  });

function getRootFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WIPO {
  const apiKey = getApiKey();
  const headless = getHeadless();
  const browser = getBrowser();
  return new WIPO({ apiKey, headless, browser });
}

// ============================================
// Patentscope Commands (PCT Applications)
// ============================================
const pctCmd = program
  .command('patentscope')
  .alias('pct')
  .description('Patentscope operations (PCT international applications)');

pctCmd
  .command('search <query>')
  .description('Search PCT applications')
  .option('-n, --rows <number>', 'Number of results', '25')
  .option('-s, --start <number>', 'Start offset', '0')
  .option('--sort <sort>', 'Sort order (relevance, date_asc, date_desc)', 'relevance')
  .option('--ipc <code>', 'Filter by IPC classification')
  .option('--country <code>', 'Filter by applicant country')
  .option('--from <date>', 'Date from (YYYY-MM-DD)')
  .option('--to <date>', 'Date to (YYYY-MM-DD)')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.patentscope.search({
        query,
        rows: parseInt(opts.rows),
        start: parseInt(opts.start),
        sort: opts.sort,
        ipc: opts.ipc,
        applicantCountry: opts.country,
        dateFrom: opts.from,
        dateTo: opts.to,
      });

      success(`Found ${result.total} PCT applications (showing ${result.applications.length})`);
      print(result.applications, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pctCmd
  .command('get <applicationNumber>')
  .description('Get PCT application by number (e.g., PCT/US2024/123456)')
  .action(async (applicationNumber: string) => {
    try {
      const client = getClient();
      const app = await client.patentscope.getByApplicationNumber(applicationNumber);

      if (app) {
        success(`PCT Application ${app.applicationNumber}`);
        print(app, getRootFormat());
      } else {
        error('Application not found');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pctCmd
  .command('publication <publicationNumber>')
  .description('Get PCT application by publication number (e.g., WO/2024/123456)')
  .action(async (publicationNumber: string) => {
    try {
      const client = getClient();
      const app = await client.patentscope.getByPublicationNumber(publicationNumber);

      if (app) {
        success(`PCT Application ${app.applicationNumber}`);
        print(app, getRootFormat());
      } else {
        error('Publication not found');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pctCmd
  .command('documents <applicationNumber>')
  .description('List documents for a PCT application')
  .action(async (applicationNumber: string) => {
    try {
      const client = getClient();
      const documents = await client.patentscope.getDocuments(applicationNumber);

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

pctCmd
  .command('family <applicationNumber>')
  .description('Get patent family members')
  .action(async (applicationNumber: string) => {
    try {
      const client = getClient();
      const family = await client.patentscope.getFamily(applicationNumber);

      if (family.length > 0) {
        success(`Found ${family.length} family members`);
        print(family, getRootFormat());
      } else {
        info('No family members found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pctCmd
  .command('by-applicant <name>')
  .description('Search PCT applications by applicant name')
  .option('-n, --rows <number>', 'Number of results', '25')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.patentscope.searchByApplicant(name, parseInt(opts.rows));

      success(`Found ${result.total} applications for "${name}"`);
      print(result.applications, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pctCmd
  .command('by-inventor <name>')
  .description('Search PCT applications by inventor name')
  .option('-n, --rows <number>', 'Number of results', '25')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.patentscope.searchByInventor(name, parseInt(opts.rows));

      success(`Found ${result.total} applications for inventor "${name}"`);
      print(result.applications, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pctCmd
  .command('recent')
  .description('Get recent PCT applications')
  .option('-n, --rows <number>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.patentscope.getRecent(parseInt(opts.rows));

      success(`Latest ${result.applications.length} PCT applications`);
      print(result.applications, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Madrid Commands (International Trademarks)
// ============================================
const madridCmd = program
  .command('madrid')
  .alias('trademark')
  .description('Madrid System operations (international trademarks)');

madridCmd
  .command('search')
  .description('Search international trademark registrations')
  .option('-q, --query <query>', 'Search query')
  .option('-m, --mark <name>', 'Mark name')
  .option('-h, --holder <name>', 'Holder name')
  .option('-c, --country <code>', 'Designated country')
  .option('--nice <class>', 'Nice classification (comma-separated)')
  .option('--status <status>', 'Status (active, inactive, all)', 'all')
  .option('-n, --rows <number>', 'Number of results', '25')
  .option('-s, --start <number>', 'Start offset', '0')
  .action(async (opts) => {
    try {
      const client = getClient();

      const niceClass = opts.nice
        ? opts.nice.split(',').map((n: string) => parseInt(n.trim()))
        : undefined;

      const result = await client.madrid.search({
        query: opts.query,
        markName: opts.mark,
        holderName: opts.holder,
        designatedCountry: opts.country,
        niceClass,
        status: opts.status,
        rows: parseInt(opts.rows),
        start: parseInt(opts.start),
      });

      success(`Found ${result.total} international marks (showing ${result.marks.length})`);
      print(result.marks, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

madridCmd
  .command('get <registrationNumber>')
  .description('Get mark by international registration number')
  .action(async (registrationNumber: string) => {
    try {
      const client = getClient();
      const mark = await client.madrid.getByRegistrationNumber(registrationNumber);

      if (mark) {
        success(`International Registration ${mark.registrationNumber}`);
        print(mark, getRootFormat());
      } else {
        error('Mark not found');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

madridCmd
  .command('status <registrationNumber>')
  .description('Get mark status and designated country statuses')
  .action(async (registrationNumber: string) => {
    try {
      const client = getClient();
      const status = await client.madrid.getStatus(registrationNumber);

      if (status) {
        success(`Status for ${status.registrationNumber}: ${status.status}`);
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

madridCmd
  .command('documents <registrationNumber>')
  .description('List documents for a mark')
  .action(async (registrationNumber: string) => {
    try {
      const client = getClient();
      const documents = await client.madrid.getDocuments(registrationNumber);

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

madridCmd
  .command('check <mark>')
  .description('Check mark name availability')
  .option('-c, --country <code>', 'Check in specific designated country')
  .action(async (mark: string, opts) => {
    try {
      const client = getClient();
      const result = await client.madrid.checkAvailability(mark, opts.country);

      if (result.available) {
        success(`"${mark}" appears to be available in the Madrid System!`);
        info('Note: This is a basic check. Consult a trademark attorney for comprehensive clearance.');
      } else {
        warn(`"${mark}" may conflict with ${result.conflicts.length} existing marks:`);
        print(result.conflicts, getRootFormat());
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

madridCmd
  .command('by-holder <name>')
  .description('Search marks by holder name')
  .option('-n, --rows <number>', 'Number of results', '25')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.madrid.searchByHolder(name, parseInt(opts.rows));

      success(`Found ${result.total} marks for holder "${name}"`);
      print(result.marks, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

madridCmd
  .command('by-country <countryCode>')
  .description('Search marks designated in a country')
  .option('-n, --rows <number>', 'Number of results', '25')
  .action(async (countryCode: string, opts) => {
    try {
      const client = getClient();
      const result = await client.madrid.searchByDesignatedCountry(countryCode, parseInt(opts.rows));

      success(`Found ${result.total} marks designated in ${countryCode}`);
      print(result.marks, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

madridCmd
  .command('expiring')
  .description('Get marks expiring soon')
  .option('-d, --days <number>', 'Days until expiry', '90')
  .option('-n, --rows <number>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.madrid.getExpiringSoon(parseInt(opts.days), parseInt(opts.rows));

      success(`Found ${result.total} marks expiring in the next ${opts.days} days`);
      print(result.marks, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// WIPO Pearl Commands (Terminology)
// ============================================
const pearlCmd = program
  .command('pearl')
  .alias('terminology')
  .description('WIPO Pearl operations (multilingual patent terminology)');

pearlCmd
  .command('search <term>')
  .description('Search for terms')
  .option('-l, --language <lang>', 'Source language code')
  .option('-t, --target <langs>', 'Target languages (comma-separated)')
  .option('-d, --domain <domain>', 'Technology domain')
  .option('--exact', 'Exact match only')
  .option('-n, --rows <number>', 'Number of results', '25')
  .action(async (term: string, opts) => {
    try {
      const client = getClient();
      const result = await client.pearl.searchTerms({
        term,
        sourceLanguage: opts.language,
        targetLanguages: opts.target?.split(','),
        domain: opts.domain,
        exactMatch: opts.exact,
        rows: parseInt(opts.rows),
      });

      success(`Found ${result.total} terms`);
      print(result.terms, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pearlCmd
  .command('translate <term>')
  .description('Translate a term')
  .requiredOption('-s, --source <lang>', 'Source language code')
  .requiredOption('-t, --target <langs>', 'Target languages (comma-separated)')
  .action(async (term: string, opts) => {
    try {
      const client = getClient();
      const result = await client.pearl.translate(
        term,
        opts.source,
        opts.target.split(',')
      );

      if (result.translations.length > 0) {
        success(`Translations for "${term}" (${opts.source}):`);
        print(result.translations, getRootFormat());
      } else {
        info('No translations found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pearlCmd
  .command('concept <conceptId>')
  .description('Get concept by ID')
  .action(async (conceptId: string) => {
    try {
      const client = getClient();
      const concept = await client.pearl.getConceptById(conceptId);

      if (concept) {
        success(`Concept: ${concept.name}`);
        print(concept, getRootFormat());
      } else {
        error('Concept not found');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pearlCmd
  .command('concepts <query>')
  .description('Search concepts')
  .option('-d, --domain <domain>', 'Technology domain')
  .option('-n, --rows <number>', 'Number of results', '25')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const concepts = await client.pearl.searchConcepts(query, opts.domain, parseInt(opts.rows));

      if (concepts.length > 0) {
        success(`Found ${concepts.length} concepts`);
        print(concepts, getRootFormat());
      } else {
        info('No concepts found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pearlCmd
  .command('synonyms <term>')
  .description('Find synonyms for a term')
  .requiredOption('-l, --language <lang>', 'Language code')
  .action(async (term: string, opts) => {
    try {
      const client = getClient();
      const synonyms = await client.pearl.findSynonyms(term, opts.language);

      if (synonyms.length > 0) {
        success(`Synonyms for "${term}":`);
        synonyms.forEach(s => console.log(`  - ${s}`));
      } else {
        info('No synonyms found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pearlCmd
  .command('languages')
  .description('List available languages')
  .action(async () => {
    try {
      const client = getClient();
      const languages = await client.pearl.getLanguages();

      if (languages.length > 0) {
        success(`${languages.length} languages available:`);
        print(languages, getRootFormat());
      } else {
        info('Could not retrieve languages');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pearlCmd
  .command('domains')
  .description('List available technology domains')
  .action(async () => {
    try {
      const client = getClient();
      const domains = await client.pearl.getDomains();

      if (domains.length > 0) {
        success(`${domains.length} domains available:`);
        print(domains, getRootFormat());
      } else {
        info('Could not retrieve domains');
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
  .command('patentscope <query>')
  .description('Search Patentscope via browser')
  .option('--type <type>', 'Search type (simple, advanced)', 'simple')
  .option('--screenshot <path>', 'Save screenshot to file')
  .action(async (query: string, opts) => {
    const client = getClient();
    try {
      info('Launching browser to search Patentscope...');
      const results = await client.browser.searchPatentscope({
        query,
        searchType: opts.type,
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
  .command('madrid <markName>')
  .description('Search Madrid Monitor via browser')
  .option('--holder <name>', 'Holder name')
  .option('--irn <number>', 'Registration number')
  .option('--screenshot <path>', 'Save screenshot to file')
  .action(async (markName: string, opts) => {
    const client = getClient();
    try {
      info('Launching browser to search Madrid Monitor...');
      const results = await client.browser.searchMadridMonitor({
        markName,
        holderName: opts.holder,
        registrationNumber: opts.irn,
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
  .command('global-brand <query>')
  .description('Search Global Brand Database via browser')
  .option('--screenshot <path>', 'Save screenshot to file')
  .action(async (query: string, opts) => {
    const client = getClient();
    try {
      info('Launching browser to search Global Brand Database...');
      const results = await client.browser.searchGlobalBrand(query, {
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
  .command('download-pct <applicationNumber> <outputPath>')
  .description('Download PCT document as PDF')
  .action(async (applicationNumber: string, outputPath: string) => {
    const client = getClient();
    try {
      info(`Downloading PCT document ${applicationNumber}...`);
      const downloaded = await client.browser.downloadPCTDocument(applicationNumber, outputPath);

      if (downloaded) {
        success(`Document saved to ${outputPath}`);
      } else {
        error('Failed to download document');
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
  .command('download-trademark-image <registrationNumber> <outputPath>')
  .description('Download trademark image')
  .action(async (registrationNumber: string, outputPath: string) => {
    const client = getClient();
    try {
      info(`Downloading trademark image for ${registrationNumber}...`);
      const downloaded = await client.browser.downloadTrademarkImage(registrationNumber, outputPath);

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
  .description('Check trademark availability via Global Brand Database')
  .action(async (mark: string) => {
    const client = getClient();
    try {
      info(`Checking trademark availability for "${mark}"...`);
      const result = await client.browser.checkTrademarkAvailability(mark);

      if (result.available) {
        success(`"${mark}" appears to be available!`);
        info('Note: This is based on Global Brand Database search. Consult a trademark attorney for comprehensive clearance.');
      } else {
        warn(`"${mark}" may conflict with ${result.conflicts.length} existing marks:`);
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
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
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
