#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync } from 'fs';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-adobe';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Adobe PDF Services API connector - compress, export, combine, split, OCR, protect, extract PDFs')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Client ID (overrides config)')
  .option('-s, --api-secret <secret>', 'Client Secret (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-r, --region <region>', 'API region (us, eu)', 'us')
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
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.ADOBE_CLIENT_ID = opts.apiKey;
      debug('Client ID set from command line flag');
    }

    if (opts.apiSecret) {
      process.env.ADOBE_CLIENT_SECRET = opts.apiSecret;
      debug('Client Secret set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = process.env.ADOBE_CLIENT_ID || getApiKey();
  const apiSecret = process.env.ADOBE_CLIENT_SECRET || getApiSecret();
  if (!apiKey) {
    error(`No Client ID configured. Run "${CONNECTOR_NAME} config set-key <client_id>" or set ADOBE_CLIENT_ID environment variable.`);
    process.exit(1);
  }
  const region = (program.opts().region || 'us') as 'us' | 'eu';
  return new Connector({ apiKey, apiSecret, region });
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
  .option('--api-key <key>', 'Client ID')
  .option('--api-secret <secret>', 'Client Secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      apiSecret: opts.apiSecret,
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
    info(`Client ID: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${config.apiSecret ? '****' : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <clientId>')
  .description('Set Client ID')
  .action((clientId: string) => {
    setApiKey(clientId);
    success(`Client ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-secret <clientSecret>')
  .description('Set Client Secret')
  .action((clientSecret: string) => {
    setApiSecret(clientSecret);
    success(`Client Secret saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Client ID: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${apiSecret ? '****' : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// PDF Operation Commands
// ============================================
const pdfCmd = program
  .command('pdf')
  .description('PDF operations (compress, export, combine, split, ocr, etc.)');

pdfCmd
  .command('compress <file>')
  .description('Compress a PDF file')
  .option('-l, --level <level>', 'Compression level (LOW, MEDIUM, HIGH)', 'MEDIUM')
  .option('-o, --output <file>', 'Output file path')
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const fileData = readFileSync(file);
      info('Uploading PDF...');
      const assetID = await client.assets.upload(Buffer.from(fileData));
      info('Starting compression...');
      const pollingUrl = await client.operations.compress({ assetID, compressionLevel: opts.level });
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      if (result.asset?.downloadUri) {
        const output = opts.output || file.replace('.pdf', '-compressed.pdf');
        const data = await client.getClient().downloadFromUri(result.asset.downloadUri);
        writeFileSync(output, data);
        success(`Compressed PDF saved to: ${output}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pdfCmd
  .command('export <file>')
  .description('Export PDF to another format')
  .requiredOption('-t, --target <format>', 'Target format (docx, doc, xlsx, pptx, rtf, jpeg, png)')
  .option('-o, --output <file>', 'Output file path')
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const fileData = readFileSync(file);
      info('Uploading PDF...');
      const assetID = await client.assets.upload(Buffer.from(fileData));
      info('Starting export...');
      const pollingUrl = await client.operations.exportPdf({ assetID, targetFormat: opts.target });
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      if (result.asset?.downloadUri) {
        const ext = opts.target;
        const output = opts.output || file.replace('.pdf', `.${ext}`);
        const data = await client.getClient().downloadFromUri(result.asset.downloadUri);
        writeFileSync(output, data);
        success(`Exported file saved to: ${output}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pdfCmd
  .command('create <file>')
  .description('Create PDF from a supported file format')
  .option('-o, --output <file>', 'Output file path')
  .option('--media-type <type>', 'MIME type of input file', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const fileData = readFileSync(file);
      info('Uploading file...');
      const assetID = await client.assets.upload(Buffer.from(fileData), opts.mediaType);
      info('Creating PDF...');
      const pollingUrl = await client.operations.createPdf(assetID);
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      if (result.asset?.downloadUri) {
        const output = opts.output || file.replace(/\.[^.]+$/, '.pdf');
        const data = await client.getClient().downloadFromUri(result.asset.downloadUri);
        writeFileSync(output, data);
        success(`PDF saved to: ${output}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pdfCmd
  .command('combine')
  .description('Combine multiple PDF files into one')
  .requiredOption('-i, --input <files...>', 'Input PDF files')
  .option('-o, --output <file>', 'Output file path', 'combined.pdf')
  .action(async (opts) => {
    try {
      const client = getClient();
      const assets: { assetID: string }[] = [];
      for (const file of opts.input) {
        info(`Uploading ${file}...`);
        const fileData = readFileSync(file);
        const assetID = await client.assets.upload(Buffer.from(fileData));
        assets.push({ assetID });
      }
      info('Combining PDFs...');
      const pollingUrl = await client.operations.combine({ assets });
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      if (result.asset?.downloadUri) {
        const data = await client.getClient().downloadFromUri(result.asset.downloadUri);
        writeFileSync(opts.output, data);
        success(`Combined PDF saved to: ${opts.output}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pdfCmd
  .command('split <file>')
  .description('Split a PDF into parts')
  .option('-c, --page-count <count>', 'Split into parts of N pages each')
  .option('-o, --output-dir <dir>', 'Output directory', '.')
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const fileData = readFileSync(file);
      info('Uploading PDF...');
      const assetID = await client.assets.upload(Buffer.from(fileData));
      info('Splitting PDF...');
      const params: { assetID: string; pageCount?: number } = { assetID };
      if (opts.pageCount) params.pageCount = parseInt(opts.pageCount);
      const pollingUrl = await client.operations.split(params);
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      if (result.assets) {
        for (let i = 0; i < result.assets.length; i++) {
          const asset = result.assets[i];
          if (asset.downloadUri) {
            const output = `${opts.outputDir}/split-${i + 1}.pdf`;
            const data = await client.getClient().downloadFromUri(asset.downloadUri);
            writeFileSync(output, data);
            info(`Part ${i + 1} saved to: ${output}`);
          }
        }
        success(`Split into ${result.assets.length} parts`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pdfCmd
  .command('ocr <file>')
  .description('OCR a scanned PDF')
  .option('-l, --locale <locale>', 'OCR locale (e.g., en-US)', 'en-US')
  .option('-t, --type <type>', 'OCR type (SEARCHABLE_IMAGE, SEARCHABLE_IMAGE_EXACT)', 'SEARCHABLE_IMAGE')
  .option('-o, --output <file>', 'Output file path')
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const fileData = readFileSync(file);
      info('Uploading PDF...');
      const assetID = await client.assets.upload(Buffer.from(fileData));
      info('Running OCR...');
      const pollingUrl = await client.operations.ocr({ assetID, ocrLocale: opts.locale, ocrType: opts.type });
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      if (result.asset?.downloadUri) {
        const output = opts.output || file.replace('.pdf', '-ocr.pdf');
        const data = await client.getClient().downloadFromUri(result.asset.downloadUri);
        writeFileSync(output, data);
        success(`OCR PDF saved to: ${output}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pdfCmd
  .command('protect <file>')
  .description('Password-protect a PDF')
  .requiredOption('--password <password>', 'User password')
  .option('--owner-password <password>', 'Owner password')
  .option('--algorithm <algorithm>', 'Encryption algorithm (AES_128, AES_256)', 'AES_256')
  .option('-o, --output <file>', 'Output file path')
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const fileData = readFileSync(file);
      info('Uploading PDF...');
      const assetID = await client.assets.upload(Buffer.from(fileData));
      info('Protecting PDF...');
      const pollingUrl = await client.operations.protect({
        assetID,
        passwordProtection: {
          userPassword: opts.password,
          ownerPassword: opts.ownerPassword,
        },
        encryptionAlgorithm: opts.algorithm,
      });
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      if (result.asset?.downloadUri) {
        const output = opts.output || file.replace('.pdf', '-protected.pdf');
        const data = await client.getClient().downloadFromUri(result.asset.downloadUri);
        writeFileSync(output, data);
        success(`Protected PDF saved to: ${output}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pdfCmd
  .command('extract <file>')
  .description('Extract text and tables from a PDF')
  .option('-e, --elements <elements...>', 'Elements to extract (text, tables)', ['text', 'tables'])
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const fileData = readFileSync(file);
      info('Uploading PDF...');
      const assetID = await client.assets.upload(Buffer.from(fileData));
      info('Extracting content...');
      const pollingUrl = await client.operations.extract({ assetID, elementsToExtract: opts.elements });
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      print(result, getFormat(pdfCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pdfCmd
  .command('watermark <file>')
  .description('Add a watermark to a PDF')
  .option('-t, --text <text>', 'Watermark text')
  .option('--font-size <size>', 'Font size')
  .option('--font-color <color>', 'Font color (hex)')
  .option('--opacity <opacity>', 'Opacity (0-1)')
  .option('-o, --output <file>', 'Output file path')
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const fileData = readFileSync(file);
      info('Uploading PDF...');
      const assetID = await client.assets.upload(Buffer.from(fileData));
      info('Adding watermark...');
      const appearance: Record<string, unknown> = {};
      if (opts.fontSize) appearance.fontSize = parseInt(opts.fontSize);
      if (opts.fontColor) appearance.fontColor = opts.fontColor;
      if (opts.opacity) appearance.opacity = parseFloat(opts.opacity);
      const pollingUrl = await client.operations.watermark({
        assetID,
        text: opts.text,
        appearance: Object.keys(appearance).length > 0 ? appearance as { fontSize?: number; fontColor?: string; opacity?: number } : undefined,
      });
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      if (result.asset?.downloadUri) {
        const output = opts.output || file.replace('.pdf', '-watermarked.pdf');
        const data = await client.getClient().downloadFromUri(result.asset.downloadUri);
        writeFileSync(output, data);
        success(`Watermarked PDF saved to: ${output}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pdfCmd
  .command('linearize <file>')
  .description('Linearize a PDF for fast web viewing')
  .option('-o, --output <file>', 'Output file path')
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const fileData = readFileSync(file);
      info('Uploading PDF...');
      const assetID = await client.assets.upload(Buffer.from(fileData));
      info('Linearizing PDF...');
      const pollingUrl = await client.operations.linearize(assetID);
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      if (result.asset?.downloadUri) {
        const output = opts.output || file.replace('.pdf', '-linearized.pdf');
        const data = await client.getClient().downloadFromUri(result.asset.downloadUri);
        writeFileSync(output, data);
        success(`Linearized PDF saved to: ${output}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pdfCmd
  .command('properties <file>')
  .description('Get PDF properties')
  .action(async (file: string) => {
    try {
      const client = getClient();
      const fileData = readFileSync(file);
      info('Uploading PDF...');
      const assetID = await client.assets.upload(Buffer.from(fileData));
      info('Getting properties...');
      const pollingUrl = await client.operations.getProperties(assetID);
      info('Waiting for job to complete...');
      const result = await client.jobs.poll(pollingUrl);
      print(result, getFormat(pdfCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
