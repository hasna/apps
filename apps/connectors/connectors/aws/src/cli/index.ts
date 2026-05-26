#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { AWS } from '../api';
import {
  getAccessKeyId,
  getSecretAccessKey,
  getRegion,
  setAccessKeyId,
  setSecretAccessKey,
  setRegion,
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
  saveProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-aws';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('AWS connector CLI - S3, Lambda, DynamoDB with multi-profile support')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-r, --region <region>', 'AWS region')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set region from flag if provided
    if (opts.region) {
      process.env.AWS_REGION = opts.region;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): AWS {
  const accessKeyId = getAccessKeyId();
  const secretAccessKey = getSecretAccessKey();
  const region = getRegion();

  if (!accessKeyId) {
    error(`No AWS Access Key ID configured. Run "${CONNECTOR_NAME} config set-credentials" or set AWS_ACCESS_KEY_ID environment variable.`);
    process.exit(1);
  }
  if (!secretAccessKey) {
    error(`No AWS Secret Access Key configured. Run "${CONNECTOR_NAME} config set-credentials" or set AWS_SECRET_ACCESS_KEY environment variable.`);
    process.exit(1);
  }

  return new AWS({ accessKeyId, secretAccessKey, region });
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
  .option('--access-key-id <key>', 'AWS Access Key ID')
  .option('--secret-access-key <secret>', 'AWS Secret Access Key')
  .option('--region <region>', 'AWS Region')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      region: opts.region,
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
    info(`Access Key ID: ${config.accessKeyId ? `${config.accessKeyId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Secret Access Key: ${config.secretAccessKey ? '********' : chalk.gray('not set')}`);
    info(`Region: ${config.region || chalk.gray('not set (defaults to us-east-1)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-credentials')
  .description('Set AWS credentials')
  .requiredOption('--access-key-id <key>', 'AWS Access Key ID')
  .requiredOption('--secret-access-key <secret>', 'AWS Secret Access Key')
  .action((opts) => {
    setAccessKeyId(opts.accessKeyId);
    setSecretAccessKey(opts.secretAccessKey);
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-region <region>')
  .description('Set AWS region')
  .action((region: string) => {
    setRegion(region);
    success(`Region set to: ${region}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessKeyId = getAccessKeyId();
    const region = getRegion();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Key ID: ${accessKeyId ? `${accessKeyId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Region: ${region}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// S3 Commands
// ============================================
const s3Cmd = program
  .command('s3')
  .description('S3 operations');

s3Cmd
  .command('ls [bucket] [prefix]')
  .description('List buckets or objects in a bucket')
  .option('-n, --max <number>', 'Maximum results', '100')
  .action(async (bucket?: string, prefix?: string, opts?: { max: string }) => {
    try {
      const client = getClient();

      if (!bucket) {
        // List buckets
        const buckets = await client.s3.listBuckets();
        print(buckets, getFormat(s3Cmd));
      } else {
        // List objects in bucket
        const result = await client.s3.listObjects(bucket, {
          prefix,
          maxKeys: parseInt(opts?.max || '100'),
        });
        print(result.contents, getFormat(s3Cmd));
        if (result.isTruncated) {
          warn(`Results truncated. Use continuation token to get more results.`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

s3Cmd
  .command('get <bucket> <key> [output]')
  .description('Download an object from S3')
  .action(async (bucket: string, key: string, output?: string) => {
    try {
      const client = getClient();
      const result = await client.s3.getObject(bucket, key);

      const outputPath = output || key.split('/').pop() || 'download';
      writeFileSync(outputPath, result.body);
      success(`Downloaded to: ${outputPath} (${result.body.length} bytes)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

s3Cmd
  .command('put <bucket> <key> <file>')
  .description('Upload a file to S3')
  .option('-t, --content-type <type>', 'Content type')
  .action(async (bucket: string, key: string, file: string, opts: { contentType?: string }) => {
    try {
      if (!existsSync(file)) {
        error(`File not found: ${file}`);
        process.exit(1);
      }

      const client = getClient();
      const body = readFileSync(file);

      const result = await client.s3.putObject({
        bucket,
        key,
        body,
        contentType: opts.contentType,
      });

      success(`Uploaded: s3://${bucket}/${key}`);
      if (result.eTag) {
        info(`ETag: ${result.eTag}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

s3Cmd
  .command('rm <bucket> <key>')
  .description('Delete an object from S3')
  .action(async (bucket: string, key: string) => {
    try {
      const client = getClient();
      await client.s3.deleteObject(bucket, key);
      success(`Deleted: s3://${bucket}/${key}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

s3Cmd
  .command('cp <source> <dest>')
  .description('Copy an object (s3://bucket/key format)')
  .action(async (source: string, dest: string) => {
    try {
      const client = getClient();

      // Parse S3 URIs
      const parseS3Uri = (uri: string) => {
        const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
        if (!match) throw new Error(`Invalid S3 URI: ${uri}`);
        return { bucket: match[1], key: match[2] };
      };

      const src = parseS3Uri(source);
      const dst = parseS3Uri(dest);

      await client.s3.copyObject(src.bucket, src.key, dst.bucket, dst.key);
      success(`Copied: ${source} -> ${dest}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

s3Cmd
  .command('head <bucket> <key>')
  .description('Get object metadata')
  .action(async (bucket: string, key: string) => {
    try {
      const client = getClient();
      const result = await client.s3.headObject(bucket, key);
      print(result, getFormat(s3Cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Lambda Commands
// ============================================
const lambdaCmd = program
  .command('lambda')
  .description('Lambda operations');

lambdaCmd
  .command('list')
  .description('List Lambda functions')
  .option('-n, --max <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.lambda.listFunctions({
        maxItems: parseInt(opts.max),
      });

      const functions = result.functions.map(f => ({
        name: f.functionName,
        runtime: f.runtime,
        memory: f.memorySize,
        timeout: f.timeout,
        state: f.state,
        lastModified: f.lastModified,
      }));

      print(functions, getFormat(lambdaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

lambdaCmd
  .command('get <name>')
  .description('Get Lambda function details')
  .action(async (name: string) => {
    try {
      const client = getClient();
      const result = await client.lambda.getFunction(name);
      print(result.configuration, getFormat(lambdaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

lambdaCmd
  .command('invoke <name>')
  .description('Invoke a Lambda function')
  .option('-p, --payload <json>', 'JSON payload')
  .option('-f, --payload-file <file>', 'File containing JSON payload')
  .option('--async', 'Async invocation')
  .option('--logs', 'Include execution logs')
  .action(async (name: string, opts: { payload?: string; payloadFile?: string; async?: boolean; logs?: boolean }) => {
    try {
      const client = getClient();

      let payload: unknown;
      if (opts.payloadFile) {
        if (!existsSync(opts.payloadFile)) {
          error(`Payload file not found: ${opts.payloadFile}`);
          process.exit(1);
        }
        payload = JSON.parse(readFileSync(opts.payloadFile, 'utf-8'));
      } else if (opts.payload) {
        payload = JSON.parse(opts.payload);
      }

      if (opts.async) {
        const result = await client.lambda.invokeAsync(name, payload);
        success(`Async invocation accepted (status: ${result.status})`);
      } else {
        const result = await client.lambda.invoke({
          functionName: name,
          payload,
          invocationType: 'RequestResponse',
          logType: opts.logs ? 'Tail' : 'None',
        });

        if (result.functionError) {
          error(`Function error: ${result.functionError}`);
        }

        print(result.payload, getFormat(lambdaCmd));

        if (result.logResult) {
          console.log(chalk.gray('\n--- Execution Logs ---'));
          console.log(result.logResult);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// DynamoDB Commands
// ============================================
const dynamoCmd = program
  .command('dynamodb')
  .description('DynamoDB operations');

dynamoCmd
  .command('list')
  .description('List DynamoDB tables')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.dynamodb.listTables();
      print(result.tableNames, getFormat(dynamoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dynamoCmd
  .command('describe <table>')
  .description('Describe a DynamoDB table')
  .action(async (table: string) => {
    try {
      const client = getClient();
      const result = await client.dynamodb.describeTable(table);
      print(result, getFormat(dynamoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dynamoCmd
  .command('get <table> <key>')
  .description('Get an item (key as JSON, e.g., \'{"id":{"S":"123"}}\')')
  .action(async (table: string, key: string) => {
    try {
      const client = getClient();
      const parsedKey = JSON.parse(key);
      const result = await client.dynamodb.getItem(table, parsedKey);

      if (result.item) {
        print(result.item, getFormat(dynamoCmd));
      } else {
        warn('Item not found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dynamoCmd
  .command('put <table> <item>')
  .description('Put an item (item as JSON)')
  .action(async (table: string, item: string) => {
    try {
      const client = getClient();
      const parsedItem = JSON.parse(item);
      await client.dynamodb.putItem(table, parsedItem);
      success(`Item written to ${table}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dynamoCmd
  .command('delete <table> <key>')
  .description('Delete an item (key as JSON)')
  .action(async (table: string, key: string) => {
    try {
      const client = getClient();
      const parsedKey = JSON.parse(key);
      await client.dynamodb.deleteItem(table, parsedKey);
      success(`Item deleted from ${table}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dynamoCmd
  .command('query <table>')
  .description('Query items from a table')
  .requiredOption('-k, --key-condition <expr>', 'Key condition expression')
  .option('-v, --values <json>', 'Expression attribute values as JSON')
  .option('-n, --names <json>', 'Expression attribute names as JSON')
  .option('-f, --filter <expr>', 'Filter expression')
  .option('-l, --limit <number>', 'Maximum items')
  .option('-i, --index <name>', 'Index name')
  .action(async (table: string, opts: {
    keyCondition: string;
    values?: string;
    names?: string;
    filter?: string;
    limit?: string;
    index?: string;
  }) => {
    try {
      const client = getClient();
      const result = await client.dynamodb.query({
        tableName: table,
        keyConditionExpression: opts.keyCondition,
        expressionAttributeValues: opts.values ? JSON.parse(opts.values) : undefined,
        expressionAttributeNames: opts.names ? JSON.parse(opts.names) : undefined,
        filterExpression: opts.filter,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        indexName: opts.index,
      });

      print(result.items, getFormat(dynamoCmd));
      info(`Count: ${result.count}, Scanned: ${result.scannedCount}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dynamoCmd
  .command('scan <table>')
  .description('Scan items from a table')
  .option('-f, --filter <expr>', 'Filter expression')
  .option('-v, --values <json>', 'Expression attribute values as JSON')
  .option('-n, --names <json>', 'Expression attribute names as JSON')
  .option('-l, --limit <number>', 'Maximum items')
  .option('-i, --index <name>', 'Index name')
  .action(async (table: string, opts: {
    filter?: string;
    values?: string;
    names?: string;
    limit?: string;
    index?: string;
  }) => {
    try {
      const client = getClient();
      const result = await client.dynamodb.scan({
        tableName: table,
        filterExpression: opts.filter,
        expressionAttributeValues: opts.values ? JSON.parse(opts.values) : undefined,
        expressionAttributeNames: opts.names ? JSON.parse(opts.names) : undefined,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        indexName: opts.index,
      });

      print(result.items, getFormat(dynamoCmd));
      info(`Count: ${result.count}, Scanned: ${result.scannedCount}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
