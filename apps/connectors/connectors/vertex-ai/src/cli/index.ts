#!/usr/bin/env bun
import { Command } from 'commander';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { VertexAI, VertexAiClient, VERTEX_AI_SCOPES, parseContentPartsJson, parseContentsJson } from '../api';
import {
  CONNECTOR_NAME,
  clearConfig,
  createProfile,
  deleteProfile,
  getAccessToken,
  getClientId,
  getClientSecret,
  getConfigDir,
  getCurrentProfile,
  getLocation,
  getProjectId,
  getRefreshToken,
  isAuthenticated,
  listProfiles,
  loadProfile,
  profileExists,
  setCredentials,
  setCurrentProfile,
  setLocation,
  setProfileOverride,
  setProjectId,
  setTokens,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { error, info, print, success } from '../utils/output';

const VERSION = '0.0.1';
const REDIRECT_PORT = 8097;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Google Cloud Vertex AI connector — Gemini, embeddings, and custom endpoints')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
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
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

async function getApi(): Promise<VertexAI> {
  try {
    return await VertexAI.ensureAuthenticated();
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

function requireProjectId(api: VertexAI, projectId?: string): string {
  try {
    return api.requireProjectId(projectId);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// Auth
const authCmd = program.command('auth').description('OAuth2 authentication');

authCmd
  .command('setup')
  .description('Save OAuth client credentials')
  .requiredOption('--client-id <id>', 'Google OAuth client ID')
  .requiredOption('--client-secret <secret>', 'Google OAuth client secret')
  .action((opts: { clientId: string; clientSecret: string }) => {
    setCredentials(opts.clientId, opts.clientSecret);
    success('OAuth credentials saved');
    info(`Run "${CONNECTOR_NAME} auth login" to authenticate`);
  });

authCmd
  .command('login')
  .description('Authenticate with Google (opens browser callback server)')
  .action(async () => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    if (!clientId || !clientSecret) {
      error(`OAuth credentials not configured. Run "${CONNECTOR_NAME} auth setup" first.`);
      process.exit(1);
    }

    const authUrl = VertexAiClient.getAuthorizationUrl(clientId, REDIRECT_URI);
    info(`Open this URL if the browser does not launch:\n${authUrl}`);

    const result = await new Promise<{ success: boolean; code?: string; error?: string }>((resolve) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url || '', `http://127.0.0.1:${REDIRECT_PORT}`);
        if (url.pathname !== '/callback') return;
        const code = url.searchParams.get('code');
        const oauthError = url.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (oauthError) {
          res.end(`<html><body><h1>Authentication failed</h1><p>${oauthError}</p></body></html>`);
          server.close();
          resolve({ success: false, error: oauthError });
          return;
        }
        if (code) {
          res.end('<html><body><h1>Authentication successful</h1><p>Return to the terminal.</p></body></html>');
          server.close();
          resolve({ success: true, code });
        }
      });
      server.listen(REDIRECT_PORT);
      setTimeout(() => {
        server.close();
        resolve({ success: false, error: 'Authentication timed out' });
      }, 5 * 60 * 1000);
    });

    if (!result.success || !result.code) {
      error(result.error || 'Authentication failed');
      process.exit(1);
    }

    const tokens = await VertexAiClient.exchangeCodeForTokens(result.code, clientId, clientSecret, REDIRECT_URI);
    setTokens(tokens);
    success(`Authenticated (profile: ${getCurrentProfile()})`);
  });

authCmd
  .command('status')
  .description('Show authentication status')
  .action((_, cmd) => {
    print(
      {
        authenticated: isAuthenticated(),
        profile: getCurrentProfile(),
        projectId: getProjectId(),
        location: getLocation(),
        hasClientCredentials: Boolean(getClientId() && getClientSecret()),
        hasRefreshToken: Boolean(getRefreshToken() || loadProfile().refreshToken),
      },
      getFormat(cmd),
    );
  });

authCmd
  .command('logout')
  .description('Clear tokens for the active profile')
  .action(() => {
    clearConfig();
    success('Cleared active profile tokens');
  });

// Config
const configCmd = program.command('config').description('Profile configuration');

configCmd
  .command('set-project <projectId>')
  .description('Set default GCP project ID')
  .action((projectId: string) => {
    setProjectId(projectId);
    success(`Project ID set to ${projectId}`);
  });

configCmd
  .command('set-location <location>')
  .description('Set default Vertex AI region')
  .action((location: string) => {
    setLocation(location);
    success(`Location set to ${location}`);
  });

configCmd
  .command('show')
  .description('Show active profile configuration')
  .action((_, cmd) => {
    print(
      {
        profile: getCurrentProfile(),
        configDir: getConfigDir(),
        projectId: getProjectId(),
        location: getLocation(),
        scopes: VERTEX_AI_SCOPES,
      },
      getFormat(cmd),
    );
  });

// Profiles
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd
  .command('list')
  .description('List profiles')
  .action((_, cmd) => print(listProfiles(), getFormat(cmd)));

profileCmd
  .command('create <name>')
  .description('Create a profile')
  .action((name: string) => {
    createProfile(name);
    success(`Created profile ${name}`);
  });

profileCmd
  .command('use <name>')
  .description('Switch active profile')
  .action((name: string) => {
    setCurrentProfile(name);
    success(`Using profile ${name}`);
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    deleteProfile(name);
    success(`Deleted profile ${name}`);
  });

// API commands
program
  .command('generate-content')
  .description('Generate content with a publisher model')
  .requiredOption('--model <model>', 'Model ID (e.g. gemini-2.5-pro)')
  .option('--project <projectId>', 'GCP project ID')
  .option('--location <location>', 'Vertex AI region')
  .option('--text <text>', 'User message text')
  .option('--contents <json>', 'Contents JSON array')
  .option('--contents-file <path>', 'Path to contents JSON file')
  .option('--system <text>', 'System instruction')
  .option('--max-output-tokens <n>', 'Max output tokens', (v) => parseInt(v, 10))
  .action(async (opts, cmd) => {
    const api = await getApi();
    const projectId = requireProjectId(api, opts.project);
    const contents = opts.contentsFile
      ? parseContentsJson(readFileSync(opts.contentsFile, 'utf-8'))
      : opts.contents
        ? parseContentsJson(opts.contents)
        : [{ role: 'user', parts: [{ text: opts.text || '' }] }];
    const result = await api.client.generateContent({
      projectId,
      location: opts.location || getLocation(),
      model: opts.model,
      contents,
      systemInstruction: opts.system,
      maxOutputTokens: opts.maxOutputTokens,
    });
    print(result, getFormat(cmd));
  });

program
  .command('stream-generate-content')
  .description('Stream-generate content with a publisher model')
  .requiredOption('--model <model>', 'Model ID')
  .option('--project <projectId>', 'GCP project ID')
  .option('--location <location>', 'Vertex AI region')
  .option('--text <text>', 'User message text')
  .option('--contents <json>', 'Contents JSON array')
  .action(async (opts, cmd) => {
    const api = await getApi();
    const projectId = requireProjectId(api, opts.project);
    const contents = opts.contents
      ? parseContentsJson(opts.contents)
      : [{ role: 'user', parts: [{ text: opts.text || '' }] }];
    const result = await api.client.streamGenerateContent({
      projectId,
      location: opts.location || getLocation(),
      model: opts.model,
      contents,
    });
    print(result, getFormat(cmd));
  });

program
  .command('count-tokens')
  .description('Count tokens for contents')
  .requiredOption('--model <model>', 'Model ID')
  .option('--project <projectId>', 'GCP project ID')
  .option('--location <location>', 'Vertex AI region')
  .option('--text <text>', 'User message text')
  .option('--contents <json>', 'Contents JSON array')
  .action(async (opts, cmd) => {
    const api = await getApi();
    const projectId = requireProjectId(api, opts.project);
    const contents = opts.contents
      ? parseContentsJson(opts.contents)
      : [{ role: 'user', parts: [{ text: opts.text || '' }] }];
    print(
      await api.client.countTokens({
        projectId,
        location: opts.location || getLocation(),
        model: opts.model,
        contents,
      }),
      getFormat(cmd),
    );
  });

program
  .command('compute-tokens')
  .description('Compute tokens for contents')
  .requiredOption('--model <model>', 'Model ID')
  .option('--project <projectId>', 'GCP project ID')
  .option('--location <location>', 'Vertex AI region')
  .option('--text <text>', 'User message text')
  .option('--contents <json>', 'Contents JSON array')
  .action(async (opts, cmd) => {
    const api = await getApi();
    const projectId = requireProjectId(api, opts.project);
    const contents = opts.contents
      ? parseContentsJson(opts.contents)
      : [{ role: 'user', parts: [{ text: opts.text || '' }] }];
    print(
      await api.client.computeTokens({
        projectId,
        location: opts.location || getLocation(),
        model: opts.model,
        contents,
      }),
      getFormat(cmd),
    );
  });

program
  .command('embed-content')
  .description('Create embeddings for content')
  .requiredOption('--model <model>', 'Embedding model ID')
  .option('--project <projectId>', 'GCP project ID')
  .option('--location <location>', 'Vertex AI region')
  .option('--text <text>', 'Text to embed')
  .option('--content <json>', 'Content JSON with parts')
  .option('--output-dimensionality <n>', 'Output dimensionality', (v) => parseInt(v, 10))
  .action(async (opts, cmd) => {
    const api = await getApi();
    const projectId = requireProjectId(api, opts.project);
    const content = opts.content ? parseContentPartsJson(opts.content) : { parts: [{ text: opts.text || '' }] };
    print(
      await api.client.embedContent({
        projectId,
        location: opts.location || getLocation(),
        model: opts.model,
        content,
        outputDimensionality: opts.outputDimensionality,
      }),
      getFormat(cmd),
    );
  });

program
  .command('list-models')
  .description('List publisher models')
  .option('--project <projectId>', 'GCP project ID')
  .option('--location <location>', 'Vertex AI region')
  .option('--publisher <publisher>', 'Model publisher', 'google')
  .action(async (opts, cmd) => {
    const api = await getApi();
    const projectId = requireProjectId(api, opts.project);
    print(
      await api.client.listModels({
        projectId,
        location: opts.location || getLocation(),
        publisher: opts.publisher,
      }),
      getFormat(cmd),
    );
  });

program
  .command('predict-image')
  .description('Run image generation predict')
  .requiredOption('--prompt <prompt>', 'Image prompt')
  .option('--project <projectId>', 'GCP project ID')
  .option('--location <location>', 'Vertex AI region')
  .option('--model <model>', 'Image model', 'imagegeneration@006')
  .option('--sample-count <n>', 'Number of images', (v) => parseInt(v, 10))
  .option('--aspect-ratio <ratio>', 'Aspect ratio', '1:1')
  .action(async (opts, cmd) => {
    const api = await getApi();
    const projectId = requireProjectId(api, opts.project);
    print(
      await api.client.predictImage({
        projectId,
        location: opts.location || getLocation(),
        model: opts.model,
        prompt: opts.prompt,
        sampleCount: opts.sampleCount,
        aspectRatio: opts.aspectRatio,
      }),
      getFormat(cmd),
    );
  });

program
  .command('endpoint-predict')
  .description('Predict on a deployed endpoint')
  .requiredOption('--endpoint <endpointId>', 'Endpoint ID')
  .requiredOption('--instances <json>', 'Instances JSON array')
  .option('--project <projectId>', 'GCP project ID')
  .option('--location <location>', 'Vertex AI region')
  .option('--parameters <json>', 'Parameters JSON object')
  .action(async (opts, cmd) => {
    const api = await getApi();
    const projectId = requireProjectId(api, opts.project);
    print(
      await api.client.endpointPredict({
        projectId,
        location: opts.location || getLocation(),
        endpointId: opts.endpoint,
        instances: JSON.parse(opts.instances) as unknown[],
        parameters: opts.parameters ? (JSON.parse(opts.parameters) as Record<string, unknown>) : undefined,
      }),
      getFormat(cmd),
    );
  });

program
  .command('endpoint-raw-predict')
  .description('Raw predict on a deployed endpoint')
  .requiredOption('--endpoint <endpointId>', 'Endpoint ID')
  .requiredOption('--body <json>', 'Request body JSON')
  .option('--project <projectId>', 'GCP project ID')
  .option('--location <location>', 'Vertex AI region')
  .action(async (opts, cmd) => {
    const api = await getApi();
    const projectId = requireProjectId(api, opts.project);
    print(
      await api.client.endpointRawPredict({
        projectId,
        location: opts.location || getLocation(),
        endpointId: opts.endpoint,
        body: JSON.parse(opts.body),
      }),
      getFormat(cmd),
    );
  });

program
  .command('raw-request')
  .description('Send an arbitrary regional Vertex AI request')
  .requiredOption('--path <path>', 'API path under /v1')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--location <location>', 'Vertex AI region')
  .option('--body <json>', 'Request body JSON')
  .option('--body-file <path>', 'Path to JSON body file')
  .action(async (opts, cmd) => {
    const api = await getApi();
    const body = opts.bodyFile ? readJsonFile(opts.bodyFile) : opts.body ? JSON.parse(opts.body) : undefined;
    print(
      await api.client.rawRequest({
        location: opts.location || getLocation(),
        path: opts.path,
        method: opts.method,
        body,
      }),
      getFormat(cmd),
    );
  });

program.parse();
