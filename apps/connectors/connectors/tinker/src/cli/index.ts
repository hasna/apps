#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { Tinker } from '../api';
import type { LossFunction, AdamParams, SamplingParams } from '../types';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getDefaultModel,
  setDefaultModel,
  getDefaultRank,
  setDefaultRank,
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

const CONNECTOR_NAME = 'connect-tinker';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tinker connector CLI - LLM fine-tuning and training API with LoRA support')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, yaml, pretty)', 'yaml')
  .option('-p, --profile <profile>', 'Use a specific profile')
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
  });

// Helper to get output format
function getFormat(): OutputFormat {
  return (program.opts().format || 'yaml') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Tinker {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();

  if (!apiKey) {
    error(`No Tinker API Key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TINKER_API_KEY environment variable.`);
    process.exit(1);
  }

  return new Tinker({ apiKey, baseUrl });
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
  .option('--api-key <key>', 'Tinker API Key')
  .option('--base-url <url>', 'Tinker API base URL')
  .option('--model <model>', 'Default base model')
  .option('--rank <rank>', 'Default LoRA rank')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      defaultModel: opts.model,
      defaultRank: opts.rank ? parseInt(opts.rank) : undefined,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
    info(`Default Model: ${config.defaultModel || chalk.gray('meta-llama/Llama-3.2-1B')}`);
    info(`Default Rank: ${config.defaultRank || chalk.gray('32')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <key>')
  .description('Set Tinker API key')
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-url <url>')
  .description('Set Tinker API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL set to: ${url}`);
  });

configCmd
  .command('set-model <model>')
  .description('Set default base model')
  .action((model: string) => {
    setDefaultModel(model);
    success(`Default model set to: ${model}`);
  });

configCmd
  .command('set-rank <rank>')
  .description('Set default LoRA rank')
  .action((rank: string) => {
    const rankNum = parseInt(rank);
    if (isNaN(rankNum) || rankNum < 1) {
      error('Rank must be a positive integer');
      process.exit(1);
    }
    setDefaultRank(rankNum);
    success(`Default rank set to: ${rankNum}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();
    const model = getDefaultModel();
    const rank = getDefaultRank();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl}`);
    info(`Default Model: ${model}`);
    info(`Default Rank: ${rank}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Models Command
// ============================================
program
  .command('models')
  .description('List available models')
  .action(async () => {
    try {
      const client = getClient();
      const capabilities = await client.training.getServerCapabilities();
      print(capabilities.models, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Training Commands
// ============================================
const trainingCmd = program
  .command('training')
  .description('Training operations');

trainingCmd
  .command('create')
  .description('Create a new LoRA training client')
  .option('-m, --model <model>', 'Base model')
  .option('-r, --rank <rank>', 'LoRA rank')
  .option('-a, --alpha <alpha>', 'LoRA alpha')
  .option('-d, --dropout <dropout>', 'LoRA dropout')
  .action(async (opts) => {
    try {
      const client = getClient();
      const model = opts.model || getDefaultModel();
      const rank = opts.rank ? parseInt(opts.rank) : getDefaultRank();

      const result = await client.training.createLoRATrainingClient({
        baseModel: model,
        rank,
        alpha: opts.alpha ? parseFloat(opts.alpha) : undefined,
        dropout: opts.dropout ? parseFloat(opts.dropout) : undefined,
      });

      print(result, getFormat());
      success(`Training client created: ${result.clientId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trainingCmd
  .command('list')
  .description('List all training clients')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.training.listTrainingClients();
      print(result.clients, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trainingCmd
  .command('info <clientId>')
  .description('Get training client information')
  .action(async (clientId: string) => {
    try {
      const client = getClient();
      const result = await client.training.getTrainingClientInfo(clientId);
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trainingCmd
  .command('delete <clientId>')
  .description('Delete a training client')
  .action(async (clientId: string) => {
    try {
      const client = getClient();
      await client.training.deleteTrainingClient(clientId);
      success(`Training client ${clientId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trainingCmd
  .command('forward <clientId>')
  .description('Run forward pass only (compute loss without gradients)')
  .requiredOption('-d, --data <file>', 'JSON file with training data')
  .option('-l, --loss <fn>', 'Loss function: cross_entropy, dpo, custom', 'cross_entropy')
  .action(async (clientId: string, opts) => {
    try {
      if (!existsSync(opts.data)) {
        error(`Data file not found: ${opts.data}`);
        process.exit(1);
      }

      const data = JSON.parse(readFileSync(opts.data, 'utf-8'));
      const client = getClient();

      const result = await client.training.forward(
        clientId,
        Array.isArray(data) ? data : [data],
        opts.loss as LossFunction
      );

      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trainingCmd
  .command('forward-backward <clientId>')
  .description('Run forward/backward pass with data from file')
  .requiredOption('-d, --data <file>', 'JSON file with training data')
  .option('-l, --loss <fn>', 'Loss function: cross_entropy, dpo, custom', 'cross_entropy')
  .action(async (clientId: string, opts) => {
    try {
      if (!existsSync(opts.data)) {
        error(`Data file not found: ${opts.data}`);
        process.exit(1);
      }

      const data = JSON.parse(readFileSync(opts.data, 'utf-8'));
      const client = getClient();

      const result = await client.training.forwardBackward(
        clientId,
        Array.isArray(data) ? data : [data],
        opts.loss as LossFunction
      );

      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trainingCmd
  .command('optim-step <clientId>')
  .description('Run optimization step')
  .option('-l, --lr <rate>', 'Learning rate', '1e-4')
  .option('--beta1 <beta1>', 'Adam beta1', '0.9')
  .option('--beta2 <beta2>', 'Adam beta2', '0.999')
  .option('--epsilon <epsilon>', 'Adam epsilon', '1e-8')
  .option('--weight-decay <wd>', 'Weight decay', '0')
  .action(async (clientId: string, opts) => {
    try {
      const client = getClient();
      const adamParams: AdamParams = {
        learningRate: parseFloat(opts.lr),
        beta1: parseFloat(opts.beta1),
        beta2: parseFloat(opts.beta2),
        epsilon: parseFloat(opts.epsilon),
        weightDecay: parseFloat(opts.weightDecay),
      };

      const result = await client.training.optimStep(clientId, adamParams);
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trainingCmd
  .command('zero-grad <clientId>')
  .description('Zero out accumulated gradients')
  .action(async (clientId: string) => {
    try {
      const client = getClient();
      await client.training.zeroGrad(clientId);
      success('Gradients zeroed');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trainingCmd
  .command('gradient-stats <clientId>')
  .description('Get gradient statistics')
  .action(async (clientId: string) => {
    try {
      const client = getClient();
      const result = await client.training.getGradientStats(clientId);
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// State Commands
// ============================================
const stateCmd = program
  .command('state')
  .description('State management operations');

stateCmd
  .command('save <clientId> <name>')
  .description('Save model state')
  .option('--ttl <seconds>', 'Time to live in seconds')
  .option('--no-optimizer', 'Exclude optimizer state')
  .action(async (clientId: string, name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.state.saveState(clientId, name, {
        ttlSeconds: opts.ttl ? parseInt(opts.ttl) : undefined,
        includeOptimizer: opts.optimizer !== false,
      });

      print(result, getFormat());
      success(`State saved to: ${result.path}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

stateCmd
  .command('load <clientId> <path>')
  .description('Load model state')
  .option('--with-optimizer', 'Include optimizer state')
  .action(async (clientId: string, path: string, opts) => {
    try {
      const client = getClient();
      let result;

      if (opts.withOptimizer) {
        result = await client.state.loadStateWithOptimizer(clientId, path);
      } else {
        result = await client.state.loadState(clientId, path);
      }

      print(result, getFormat());
      success('State loaded');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

stateCmd
  .command('list')
  .description('List saved states')
  .option('--prefix <prefix>', 'Filter by prefix')
  .option('-n, --limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.state.listStates({
        prefix: opts.prefix,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      print(result.states, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

stateCmd
  .command('info <path>')
  .description('Get state information')
  .action(async (path: string) => {
    try {
      const client = getClient();
      const result = await client.state.getStateInfo(path);
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

stateCmd
  .command('download <path> [output]')
  .description('Download checkpoint')
  .action(async (path: string, output?: string) => {
    try {
      const client = getClient();
      const outputPath = output || `${path.replace(/\//g, '_')}.tar.gz`;

      info(`Downloading checkpoint to: ${outputPath}`);
      await client.state.downloadCheckpoint(path, outputPath);
      success(`Checkpoint downloaded to: ${outputPath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

stateCmd
  .command('delete <path>')
  .description('Delete a saved state')
  .action(async (path: string) => {
    try {
      const client = getClient();
      await client.state.deleteState(path);
      success(`State deleted: ${path}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

stateCmd
  .command('extend-ttl <path>')
  .description('Extend state TTL')
  .requiredOption('--seconds <seconds>', 'Additional seconds')
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const result = await client.state.extendStateTTL(path, parseInt(opts.seconds));
      print(result, getFormat());
      success(`TTL extended for: ${path}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Sampling Commands
// ============================================
const samplingCmd = program
  .command('sampling')
  .description('Sampling/inference operations');

samplingCmd
  .command('create <modelPath>')
  .description('Create a new sampling client')
  .action(async (modelPath: string) => {
    try {
      const client = getClient();
      const result = await client.sampling.createSamplingClient(modelPath);

      print(result, getFormat());
      success(`Sampling client created: ${result.clientId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

samplingCmd
  .command('list')
  .description('List all sampling clients')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.sampling.listSamplingClients();
      print(result.clients, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

samplingCmd
  .command('info <clientId>')
  .description('Get sampling client information')
  .action(async (clientId: string) => {
    try {
      const client = getClient();
      const result = await client.sampling.getSamplingClientInfo(clientId);
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

samplingCmd
  .command('delete <clientId>')
  .description('Delete a sampling client')
  .action(async (clientId: string) => {
    try {
      const client = getClient();
      await client.sampling.deleteSamplingClient(clientId);
      success(`Sampling client ${clientId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

samplingCmd
  .command('sample <clientId>')
  .description('Generate samples from model')
  .requiredOption('-i, --input <file>', 'JSON file with prompt (ModelInput format)')
  .option('-n, --num <number>', 'Number of samples', '1')
  .option('-m, --max-tokens <number>', 'Maximum tokens', '256')
  .option('-t, --temperature <temp>', 'Temperature', '0.7')
  .option('--top-p <p>', 'Top-p sampling')
  .option('--top-k <k>', 'Top-k sampling')
  .option('--stop <sequences>', 'Stop sequences (comma-separated)')
  .option('--seed <seed>', 'Random seed')
  .option('--logprobs', 'Include prompt logprobs')
  .action(async (clientId: string, opts) => {
    try {
      if (!existsSync(opts.input)) {
        error(`Input file not found: ${opts.input}`);
        process.exit(1);
      }

      const prompt = JSON.parse(readFileSync(opts.input, 'utf-8'));
      const client = getClient();

      const samplingParams: SamplingParams = {
        maxTokens: parseInt(opts.maxTokens),
        temperature: parseFloat(opts.temperature),
        topP: opts.topP ? parseFloat(opts.topP) : undefined,
        topK: opts.topK ? parseInt(opts.topK) : undefined,
        stop: opts.stop ? opts.stop.split(',').map((s: string) => s.trim()) : undefined,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
      };

      const result = await client.sampling.sample(
        clientId,
        prompt,
        samplingParams,
        {
          numSamples: parseInt(opts.num),
          includePromptLogprobs: opts.logprobs,
        }
      );

      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

samplingCmd
  .command('logprobs <clientId>')
  .description('Compute log probabilities for a prompt')
  .requiredOption('-i, --input <file>', 'JSON file with prompt (ModelInput format)')
  .action(async (clientId: string, opts) => {
    try {
      if (!existsSync(opts.input)) {
        error(`Input file not found: ${opts.input}`);
        process.exit(1);
      }

      const prompt = JSON.parse(readFileSync(opts.input, 'utf-8'));
      const client = getClient();

      const result = await client.sampling.computeLogprobs(clientId, prompt);
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Quick Train Command (Convenience)
// ============================================
program
  .command('train')
  .description('Quick training loop (create client, train, save)')
  .requiredOption('-d, --data <file>', 'Training data JSON file')
  .option('-m, --model <model>', 'Base model')
  .option('-r, --rank <rank>', 'LoRA rank')
  .option('-s, --steps <steps>', 'Number of optimization steps', '1')
  .option('-l, --lr <rate>', 'Learning rate', '1e-4')
  .option('-o, --output <name>', 'Output checkpoint name')
  .action(async (opts) => {
    try {
      if (!existsSync(opts.data)) {
        error(`Data file not found: ${opts.data}`);
        process.exit(1);
      }

      const data = JSON.parse(readFileSync(opts.data, 'utf-8'));
      const client = getClient();
      const model = opts.model || getDefaultModel();
      const rank = opts.rank ? parseInt(opts.rank) : getDefaultRank();
      const steps = parseInt(opts.steps);
      const lr = parseFloat(opts.lr);

      // Create training client
      info(`Creating training client with ${model} (rank=${rank})...`);
      const createResult = await client.training.createLoRATrainingClient({
        baseModel: model,
        rank,
      });
      const clientId = createResult.clientId;
      success(`Training client created: ${clientId}`);

      // Training loop
      for (let step = 0; step < steps; step++) {
        info(`Step ${step + 1}/${steps}: Forward/backward pass...`);
        const fbResult = await client.training.forwardBackward(
          clientId,
          Array.isArray(data) ? data : [data],
          'cross_entropy'
        );
        info(`  Loss: ${fbResult.loss.toFixed(6)}`);

        info(`Step ${step + 1}/${steps}: Optimization step...`);
        await client.training.optimStep(clientId, { learningRate: lr });
      }

      // Save checkpoint if requested
      if (opts.output) {
        info(`Saving checkpoint: ${opts.output}...`);
        const saveResult = await client.state.saveState(clientId, opts.output);
        success(`Checkpoint saved to: ${saveResult.path}`);
      }

      success('Training complete!');
      print({ clientId, steps, model, rank }, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
