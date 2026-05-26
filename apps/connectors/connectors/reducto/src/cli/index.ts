#!/usr/bin/env bun
import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { ReductoClient } from '../api';
import {
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  getConfigDir,
  getBaseConfigDir,
  getApiKey,
  setApiKey,
  clearApiKey,
  loadProfile,
} from '../utils/config';
import {
  success,
  error,
  info,
  printParseResult,
  printExtractResult,
  printSplitResult,
  printEditResult,
  printJobStatus,
  printDocument,
  printDocuments,
} from '../utils/output';
import type { OutputFormat, Schema, FieldDefinition } from '../types';

const program = new Command();

function getFormat(cmd: Command): OutputFormat {
  const opts = cmd.optsWithGlobals();
  return opts.format || 'pretty';
}

function getClient(): ReductoClient {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Not authenticated. Run "connect-reducto auth setup" first.');
  }
  return new ReductoClient(apiKey);
}

program
  .name('connect-reducto')
  .description('Reducto API CLI - Document parsing, extraction, and manipulation')
  .version('0.1.0')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Authentication commands');

authCmd
  .command('setup')
  .description('Set up API key')
  .requiredOption('--api-key <key>', 'Reducto API key')
  .action(async function(this: Command, opts) {
    try {
      setApiKey(opts.apiKey);
      success('API key saved');
      info('You can now use Reducto commands');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd
  .command('logout')
  .description('Clear stored API key')
  .action(async function(this: Command) {
    try {
      clearApiKey();
      success('Logged out successfully');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(async function(this: Command) {
    try {
      const apiKey = getApiKey();
      if (apiKey) {
        success('Authenticated');
        info(`API key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);
      } else {
        info('Not authenticated. Run "connect-reducto auth setup" first.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
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
  .action(function(this: Command) {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      info('No profiles found');
      return;
    }

    success('Profiles:');
    for (const profile of profiles) {
      const marker = profile === current ? ' (active)' : '';
      console.log(`  ${profile}${marker}`);
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action(function(this: Command, name: string) {
    try {
      setCurrentProfile(name);
      success(`Switched to profile "${name}"`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action(function(this: Command, name: string) {
    try {
      if (createProfile(name)) {
        success(`Profile "${name}" created`);
      } else {
        error(`Profile "${name}" already exists`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action(function(this: Command, name: string) {
    try {
      if (deleteProfile(name)) {
        success(`Profile "${name}" deleted`);
      } else {
        error(`Cannot delete profile "${name}"`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('show')
  .description('Show current configuration')
  .action(function(this: Command) {
    const profile = getCurrentProfile();
    info(`Active Profile: ${profile}`);
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);

    const config = loadProfile();
    if (config.apiKey) {
      info(`API Key: ${config.apiKey.substring(0, 10)}...`);
    }
  });

// ============================================
// Parse Commands
// ============================================
const parseCmd = program
  .command('parse')
  .description('Parse documents to extract content');

parseCmd
  .command('url <documentUrl>')
  .description('Parse a document from URL')
  .option('--chunking <strategy>', 'Chunking strategy (page, section, paragraph, none)')
  .option('--output-mode <mode>', 'Output mode (text, markdown, html)')
  .option('--extract-tables', 'Extract tables')
  .option('--extract-images', 'Extract images')
  .option('--page-range <range>', 'Page range (e.g., "1-5" or "1,3,5")')
  .option('--priority <level>', 'Priority (standard, high)')
  .action(async function(this: Command, documentUrl: string, opts) {
    try {
      const client = getClient();
      const result = await client.parseUrl(documentUrl, {
        chunkingStrategy: opts.chunking,
        outputMode: opts.outputMode,
        extractTables: opts.extractTables,
        extractImages: opts.extractImages,
        pageRange: opts.pageRange,
        priority: opts.priority,
      });
      printParseResult(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

parseCmd
  .command('file <filePath>')
  .description('Parse a local document file')
  .option('--chunking <strategy>', 'Chunking strategy (page, section, paragraph, none)')
  .option('--output-mode <mode>', 'Output mode (text, markdown, html)')
  .option('--extract-tables', 'Extract tables')
  .option('--extract-images', 'Extract images')
  .option('--page-range <range>', 'Page range (e.g., "1-5" or "1,3,5")')
  .option('--priority <level>', 'Priority (standard, high)')
  .action(async function(this: Command, filePath: string, opts) {
    try {
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const client = getClient();
      const result = await client.parseFile(filePath, {
        chunkingStrategy: opts.chunking,
        outputMode: opts.outputMode,
        extractTables: opts.extractTables,
        extractImages: opts.extractImages,
        pageRange: opts.pageRange,
        priority: opts.priority,
      });
      printParseResult(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Extract Commands
// ============================================
const extractCmd = program
  .command('extract')
  .description('Extract structured data from documents');

extractCmd
  .command('url <documentUrl>')
  .description('Extract data from document URL')
  .requiredOption('--schema <file>', 'Path to JSON schema file')
  .option('--examples <file>', 'Path to examples JSON file')
  .option('--priority <level>', 'Priority (standard, high)')
  .action(async function(this: Command, documentUrl: string, opts) {
    try {
      const schemaContent = readFileSync(opts.schema, 'utf-8');
      const schema = JSON.parse(schemaContent) as Schema;

      let examples;
      if (opts.examples) {
        const examplesContent = readFileSync(opts.examples, 'utf-8');
        examples = JSON.parse(examplesContent);
      }

      const client = getClient();
      const result = await client.extractUrl(documentUrl, {
        schema,
        examples,
        priority: opts.priority,
      });
      printExtractResult(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

extractCmd
  .command('file <filePath>')
  .description('Extract data from local file')
  .requiredOption('--schema <file>', 'Path to JSON schema file')
  .option('--examples <file>', 'Path to examples JSON file')
  .option('--priority <level>', 'Priority (standard, high)')
  .action(async function(this: Command, filePath: string, opts) {
    try {
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const schemaContent = readFileSync(opts.schema, 'utf-8');
      const schema = JSON.parse(schemaContent) as Schema;

      let examples;
      if (opts.examples) {
        const examplesContent = readFileSync(opts.examples, 'utf-8');
        examples = JSON.parse(examplesContent);
      }

      const client = getClient();
      const result = await client.extractFile(filePath, {
        schema,
        examples,
        priority: opts.priority,
      });
      printExtractResult(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Split Commands
// ============================================
const splitCmd = program
  .command('split')
  .description('Split documents into segments');

splitCmd
  .command('url <documentUrl>')
  .description('Split a document from URL')
  .option('--split-by <method>', 'Split method (page, section, custom)')
  .option('--delimiter <text>', 'Custom delimiter for custom split')
  .option('--max-size <number>', 'Maximum chunk size', parseInt)
  .option('--overlap <number>', 'Overlap between chunks', parseInt)
  .action(async function(this: Command, documentUrl: string, opts) {
    try {
      const client = getClient();
      const result = await client.splitUrl(documentUrl, {
        splitBy: opts.splitBy,
        customDelimiter: opts.delimiter,
        maxChunkSize: opts.maxSize,
        overlap: opts.overlap,
      });
      printSplitResult(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitCmd
  .command('file <filePath>')
  .description('Split a local document file')
  .option('--split-by <method>', 'Split method (page, section, custom)')
  .option('--delimiter <text>', 'Custom delimiter for custom split')
  .option('--max-size <number>', 'Maximum chunk size', parseInt)
  .option('--overlap <number>', 'Overlap between chunks', parseInt)
  .action(async function(this: Command, filePath: string, opts) {
    try {
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const client = getClient();
      const result = await client.splitFile(filePath, {
        splitBy: opts.splitBy,
        customDelimiter: opts.delimiter,
        maxChunkSize: opts.maxSize,
        overlap: opts.overlap,
      });
      printSplitResult(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Edit Commands
// ============================================
const editCmd = program
  .command('edit')
  .description('Edit documents (fill forms, modify content)');

editCmd
  .command('url <documentUrl>')
  .description('Edit a document from URL')
  .requiredOption('--edits <file>', 'Path to JSON edits file')
  .option('--output-format <format>', 'Output format (pdf, docx)')
  .option('--flatten', 'Flatten form fields')
  .action(async function(this: Command, documentUrl: string, opts) {
    try {
      const editsContent = readFileSync(opts.edits, 'utf-8');
      const edits = JSON.parse(editsContent);

      const client = getClient();
      const result = await client.editUrl(documentUrl, {
        edits,
        outputFormat: opts.outputFormat,
        flatten: opts.flatten,
      });
      printEditResult(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

editCmd
  .command('file <filePath>')
  .description('Edit a local document file')
  .requiredOption('--edits <file>', 'Path to JSON edits file')
  .option('--output-format <format>', 'Output format (pdf, docx)')
  .option('--flatten', 'Flatten form fields')
  .action(async function(this: Command, filePath: string, opts) {
    try {
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const editsContent = readFileSync(opts.edits, 'utf-8');
      const edits = JSON.parse(editsContent);

      const client = getClient();
      const result = await client.editFile(filePath, {
        edits,
        outputFormat: opts.outputFormat,
        flatten: opts.flatten,
      });
      printEditResult(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Jobs Commands
// ============================================
const jobsCmd = program
  .command('jobs')
  .description('Manage processing jobs');

jobsCmd
  .command('list')
  .alias('ls')
  .description('List recent jobs')
  .option('--limit <number>', 'Maximum number of jobs', parseInt)
  .option('--offset <number>', 'Offset for pagination', parseInt)
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const jobs = await client.listJobs(opts.limit, opts.offset);

      if (getFormat(this) === 'json') {
        console.log(JSON.stringify(jobs, null, 2));
      } else {
        if (jobs.length === 0) {
          info('No jobs found');
          return;
        }

        success(`Jobs (${jobs.length}):`);
        for (const job of jobs) {
          printJobStatus(job, 'pretty');
          console.log();
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobsCmd
  .command('get <jobId>')
  .description('Get job status')
  .action(async function(this: Command, jobId: string) {
    try {
      const client = getClient();
      const job = await client.getJobStatus(jobId);
      printJobStatus(job, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobsCmd
  .command('cancel <jobId>')
  .description('Cancel a job')
  .action(async function(this: Command, jobId: string) {
    try {
      const client = getClient();
      await client.cancelJob(jobId);
      success('Job cancelled');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Documents Commands
// ============================================
const docsCmd = program
  .command('documents')
  .alias('docs')
  .description('Manage documents');

docsCmd
  .command('list')
  .alias('ls')
  .description('List documents')
  .option('--limit <number>', 'Maximum number of documents', parseInt)
  .option('--offset <number>', 'Offset for pagination', parseInt)
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const docs = await client.listDocuments(opts.limit, opts.offset);
      printDocuments(docs, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

docsCmd
  .command('get <documentId>')
  .description('Get document details')
  .action(async function(this: Command, documentId: string) {
    try {
      const client = getClient();
      const doc = await client.getDocument(documentId);
      printDocument(doc, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

docsCmd
  .command('delete <documentId>')
  .alias('rm')
  .description('Delete a document')
  .action(async function(this: Command, documentId: string) {
    try {
      const client = getClient();
      await client.deleteDocument(documentId);
      success('Document deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
