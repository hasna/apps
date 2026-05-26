#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Exa } from '../api';
import {
  getApiKey,
  setApiKey,
  clearConfig,
  getConfigDir,
  getBaseConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
  getExportsDir,
  getImportsDir,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-exa';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Exa AI Search API CLI - Web search, content retrieval, answers, and research')
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
      process.env.EXA_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Exa {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set EXA_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Exa({ apiKey });
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
    console.log();
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);
    info(`Exports directory: ${getExportsDir()}`);
    info(`Imports directory: ${getImportsDir()}`);
    console.log();
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
// Search Commands
// ============================================
const searchCmd = program
  .command('search')
  .description('Web search');

searchCmd
  .command('query <query>')
  .description('Perform a web search')
  .option('-n, --num-results <number>', 'Number of results', '10')
  .option('-t, --type <type>', 'Search type (auto, neural, keyword)', 'auto')
  .option('-c, --category <category>', 'Category filter')
  .option('--autoprompt', 'Use autoprompt to optimize query')
  .option('--include-domains <domains>', 'Comma-separated domains to include')
  .option('--exclude-domains <domains>', 'Comma-separated domains to exclude')
  .option('--start-date <date>', 'Start published date (YYYY-MM-DD)')
  .option('--end-date <date>', 'End published date (YYYY-MM-DD)')
  .option('--with-text', 'Include page text in results')
  .option('--with-highlights', 'Include highlights in results')
  .option('--with-summary', 'Include summary in results')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.search.search({
        query,
        type: opts.type,
        category: opts.category,
        numResults: parseInt(opts.numResults),
        useAutoprompt: opts.autoprompt,
        includeDomains: opts.includeDomains?.split(','),
        excludeDomains: opts.excludeDomains?.split(','),
        startPublishedDate: opts.startDate,
        endPublishedDate: opts.endDate,
        contents: (opts.withText || opts.withHighlights || opts.withSummary) ? {
          text: opts.withText || undefined,
          highlights: opts.withHighlights || undefined,
          summary: opts.withSummary || undefined,
        } : undefined,
      });

      if (getFormat(searchCmd) === 'json') {
        print(result, 'json');
      } else {
        if (result.autopromptString) {
          info(`Autoprompt: ${result.autopromptString}`);
        }
        success(`Search Results (${result.results.length} found):`);
        result.results.forEach((r, i) => {
          console.log(`  ${chalk.cyan(`[${i + 1}]`)} ${chalk.bold(r.title)}`);
          console.log(`      ${chalk.gray(r.url)}`);
          if (r.publishedDate) console.log(`      Published: ${r.publishedDate}`);
          if (r.score) console.log(`      Score: ${r.score.toFixed(4)}`);
          if (r.summary) console.log(`      Summary: ${r.summary.substring(0, 200)}...`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Contents Commands
// ============================================
const contentsCmd = program
  .command('contents')
  .description('Get page contents');

contentsCmd
  .command('get <urls...>')
  .description('Get contents from URLs')
  .option('--text', 'Get text content', true)
  .option('--highlights', 'Get highlights')
  .option('--summary', 'Get summary')
  .option('--max-chars <number>', 'Max characters for text')
  .action(async (urls: string[], opts) => {
    try {
      const client = getClient();
      const result = await client.contents.get({
        urls,
        text: opts.text ? (opts.maxChars ? { maxCharacters: parseInt(opts.maxChars) } : true) : undefined,
        highlights: opts.highlights,
        summary: opts.summary,
      });

      if (getFormat(contentsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Contents (${result.results.length} pages):`);
        result.results.forEach((r, i) => {
          console.log(`  ${chalk.cyan(`[${i + 1}]`)} ${chalk.bold(r.title)}`);
          console.log(`      ${chalk.gray(r.url)}`);
          if (r.text) {
            console.log(`      Text: ${r.text.substring(0, 300)}...`);
          }
          if (r.highlights?.length) {
            console.log(`      Highlights: ${r.highlights.length} found`);
          }
          if (r.summary) {
            console.log(`      Summary: ${r.summary}`);
          }
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Similar Commands
// ============================================
const similarCmd = program
  .command('similar')
  .description('Find similar pages');

similarCmd
  .command('find <url>')
  .description('Find pages similar to a URL')
  .option('-n, --num-results <number>', 'Number of results', '10')
  .option('--exclude-source', 'Exclude the source domain')
  .option('--include-domains <domains>', 'Comma-separated domains to include')
  .option('--exclude-domains <domains>', 'Comma-separated domains to exclude')
  .option('-c, --category <category>', 'Category filter')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const result = await client.similar.find({
        url,
        numResults: parseInt(opts.numResults),
        excludeSourceDomain: opts.excludeSource,
        includeDomains: opts.includeDomains?.split(','),
        excludeDomains: opts.excludeDomains?.split(','),
        category: opts.category,
      });

      if (getFormat(similarCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Similar Pages (${result.results.length} found):`);
        result.results.forEach((r, i) => {
          console.log(`  ${chalk.cyan(`[${i + 1}]`)} ${chalk.bold(r.title)}`);
          console.log(`      ${chalk.gray(r.url)}`);
          if (r.score) console.log(`      Score: ${r.score.toFixed(4)}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Answer Commands
// ============================================
const answerCmd = program
  .command('answer')
  .description('Get answers to questions');

answerCmd
  .command('ask <question>')
  .description('Ask a question and get an answer with citations')
  .option('-m, --model <model>', 'Model (exa, exa-pro)', 'exa')
  .option('--with-text', 'Include source text')
  .option('--stream', 'Stream the response')
  .action(async (question: string, opts) => {
    try {
      const client = getClient();

      if (opts.stream) {
        process.stdout.write(chalk.bold('Answer: '));
        let citations: Array<{ url: string; title: string }> = [];

        for await (const event of client.answer.stream(question, opts.model)) {
          if (event.type === 'content' && event.content) {
            process.stdout.write(event.content);
          }
          if (event.type === 'citations' && event.citations) {
            citations = event.citations;
          }
        }

        console.log('\n');
        if (citations.length > 0) {
          console.log(chalk.bold('Citations:'));
          citations.forEach((c, i) => {
            console.log(`  ${chalk.cyan(`[${i + 1}]`)} ${c.title}`);
            console.log(`      ${chalk.gray(c.url)}`);
          });
        }
      } else {
        const result = await client.answer.ask({
          query: question,
          model: opts.model,
          text: opts.withText,
        });

        if (getFormat(answerCmd) === 'json') {
          print(result, 'json');
        } else {
          console.log(chalk.bold('Answer:'));
          console.log(result.answer);
          console.log();
          if (result.citations.length > 0) {
            console.log(chalk.bold('Citations:'));
            result.citations.forEach((c, i) => {
              console.log(`  ${chalk.cyan(`[${i + 1}]`)} ${c.title}`);
              console.log(`      ${chalk.gray(c.url)}`);
            });
          }
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Context Commands
// ============================================
const contextCmd = program
  .command('context')
  .description('Code context search');

contextCmd
  .command('search <query>')
  .description('Search for code context')
  .option('-t, --tokens <number>', 'Number of tokens (or "dynamic")', 'dynamic')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const tokensNum = opts.tokens === 'dynamic' ? 'dynamic' : parseInt(opts.tokens);
      const result = await client.context.search({
        query,
        tokensNum,
      });

      if (getFormat(contextCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Code Context (${result.resultsCount} sources, ${result.outputTokens} tokens):`);
        console.log();
        console.log(result.response);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Research Commands
// ============================================
const researchCmd = program
  .command('research')
  .description('Manage research tasks');

researchCmd
  .command('create <query>')
  .description('Create a new research task')
  .option('-d, --depth <depth>', 'Research depth (basic, thorough, comprehensive)', 'basic')
  .option('--wait', 'Wait for completion')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();

      if (opts.wait) {
        info('Creating research task and waiting for completion...');
        const result = await client.research.createAndWait({
          query,
          depth: opts.depth,
        });
        print(result, getFormat(researchCmd));
      } else {
        const result = await client.research.create({
          query,
          depth: opts.depth,
        });
        success(`Research task created: ${result.id}`);
        print(result, getFormat(researchCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

researchCmd
  .command('get <taskId>')
  .description('Get a research task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.research.get(taskId);
      print(result, getFormat(researchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

researchCmd
  .command('list')
  .description('List research tasks')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.research.list({
        limit: parseInt(opts.limit),
        status: opts.status,
      });

      if (getFormat(researchCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Research Tasks (${result.total} total):`);
        result.tasks.forEach(task => {
          console.log(`  ${chalk.bold(task.id)} - ${task.status}`);
          console.log(`    Query: ${task.query}`);
          console.log(`    Created: ${task.createdAt}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

researchCmd
  .command('cancel <taskId>')
  .description('Cancel a research task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.research.cancel(taskId);
      success(`Research task cancelled: ${taskId}`);
      print(result, getFormat(researchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Websets Commands
// ============================================
const websetsCmd = program
  .command('websets')
  .description('Manage websets');

websetsCmd
  .command('create')
  .description('Create a new webset')
  .requiredOption('-q, --query <query>', 'Search query')
  .requiredOption('-e, --entity <type>', 'Entity type')
  .option('-n, --num-results <number>', 'Number of results', '10')
  .option('--external-id <id>', 'External ID')
  .option('--wait', 'Wait for completion')
  .action(async (opts) => {
    try {
      const client = getClient();

      const createOptions = {
        searches: [{
          query: opts.query,
          entity: { type: opts.entity },
          numResults: parseInt(opts.numResults),
        }],
        externalId: opts.externalId,
      };

      if (opts.wait) {
        info('Creating webset and waiting for completion...');
        const result = await client.websets.createAndWait(createOptions);
        print(result, getFormat(websetsCmd));
      } else {
        const result = await client.websets.create(createOptions);
        success(`Webset created: ${result.id}`);
        print(result, getFormat(websetsCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

websetsCmd
  .command('get <websetId>')
  .description('Get a webset')
  .action(async (websetId: string) => {
    try {
      const client = getClient();
      const result = await client.websets.get(websetId);
      print(result, getFormat(websetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

websetsCmd
  .command('list')
  .description('List websets')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.websets.list({
        limit: parseInt(opts.limit),
        status: opts.status,
      });

      if (getFormat(websetsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Websets:`);
        result.websets.forEach(ws => {
          console.log(`  ${chalk.bold(ws.id)} - ${ws.status}`);
          console.log(`    Searches: ${ws.searches.length}`);
          console.log(`    Created: ${ws.createdAt}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

websetsCmd
  .command('items <websetId>')
  .description('List items in a webset')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .action(async (websetId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.websets.listItems(websetId, {
        limit: parseInt(opts.limit),
      });

      if (getFormat(websetsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Webset Items (${result.total} total):`);
        result.items.forEach(item => {
          console.log(`  ${chalk.bold(item.id)}`);
          console.log(`    URL: ${item.url}`);
          console.log(`    Properties: ${JSON.stringify(item.properties)}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

websetsCmd
  .command('delete <websetId>')
  .description('Delete a webset')
  .action(async (websetId: string) => {
    try {
      const client = getClient();
      await client.websets.delete(websetId);
      success(`Webset deleted: ${websetId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

websetsCmd
  .command('cancel <websetId>')
  .description('Cancel a running webset')
  .action(async (websetId: string) => {
    try {
      const client = getClient();
      const result = await client.websets.cancel(websetId);
      success(`Webset cancelled: ${websetId}`);
      print(result, getFormat(websetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Team/API Key Commands
// ============================================
const teamCmd = program
  .command('team')
  .description('Manage team API keys');

teamCmd
  .command('list-keys')
  .description('List all API keys')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.team.listKeys();

      if (getFormat(teamCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`API Keys (${result.total} total):`);
        result.keys.forEach(key => {
          console.log(`  ${chalk.bold(key.name)} (${key.prefix}...)`);
          console.log(`    ID: ${key.id}`);
          console.log(`    Created: ${key.createdAt}`);
          if (key.rateLimit) console.log(`    Rate Limit: ${key.rateLimit}/min`);
          if (key.monthlyLimit) console.log(`    Monthly Limit: ${key.monthlyLimit}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('create-key <name>')
  .description('Create a new API key')
  .option('--rate-limit <number>', 'Rate limit (requests per minute)')
  .option('--monthly-limit <number>', 'Monthly request limit')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.team.createKey({
        name,
        rateLimit: opts.rateLimit ? parseInt(opts.rateLimit) : undefined,
        monthlyLimit: opts.monthlyLimit ? parseInt(opts.monthlyLimit) : undefined,
      });

      success(`API key created: ${name}`);
      console.log(chalk.yellow(`Key: ${result.key}`));
      console.log(chalk.gray('(Save this key - it will not be shown again)'));
      print(result, getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('get-key <keyId>')
  .description('Get API key details')
  .action(async (keyId: string) => {
    try {
      const client = getClient();
      const result = await client.team.getKey(keyId);
      print(result, getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('update-key <keyId>')
  .description('Update an API key')
  .option('-n, --name <name>', 'New name')
  .option('--rate-limit <number>', 'New rate limit')
  .option('--monthly-limit <number>', 'New monthly limit')
  .action(async (keyId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.team.updateKey(keyId, {
        name: opts.name,
        rateLimit: opts.rateLimit ? parseInt(opts.rateLimit) : undefined,
        monthlyLimit: opts.monthlyLimit ? parseInt(opts.monthlyLimit) : undefined,
      });

      success(`API key updated: ${keyId}`);
      print(result, getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('delete-key <keyId>')
  .description('Delete an API key')
  .action(async (keyId: string) => {
    try {
      const client = getClient();
      await client.team.deleteKey(keyId);
      success(`API key deleted: ${keyId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('usage <keyId>')
  .description('Get usage for an API key')
  .option('--period <period>', 'Usage period (e.g., "2024-01")')
  .action(async (keyId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.team.getKeyUsage(keyId, opts.period);
      print(result, getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
