#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { Figma } from '../api';
import {
  getAccessToken,
  setAccessToken,
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
import type { ImageFormat } from '../types';

const CONNECTOR_NAME = 'connect-figma';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Figma connector CLI - Files, Comments, Projects, Components with multi-profile support')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
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
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Figma {
  const accessToken = getAccessToken();

  if (!accessToken) {
    error(`No Figma access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set FIGMA_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }

  return new Figma({ accessToken });
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
  .option('--token <token>', 'Figma access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set Figma access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Files Commands
// ============================================
const filesCmd = program
  .command('files')
  .description('File operations');

filesCmd
  .command('get <fileKey>')
  .description('Get file information')
  .option('-v, --version <version>', 'Specific version to retrieve')
  .option('-d, --depth <depth>', 'Depth to retrieve (for nested nodes)', '1')
  .option('--ids <ids>', 'Comma-separated node IDs to retrieve')
  .option('--branches', 'Include branch data')
  .action(async (fileKey: string, opts: { version?: string; depth?: string; ids?: string; branches?: boolean }) => {
    try {
      const client = getClient();
      const result = await client.files.getFile(fileKey, {
        version: opts.version,
        depth: opts.depth ? parseInt(opts.depth) : undefined,
        ids: opts.ids ? opts.ids.split(',') : undefined,
        branch_data: opts.branches,
      });

      // Output simplified info by default
      const output = {
        name: result.name,
        lastModified: result.lastModified,
        version: result.version,
        editorType: result.editorType,
        thumbnailUrl: result.thumbnailUrl,
        schemaVersion: result.schemaVersion,
        componentCount: result.components ? Object.keys(result.components).length : 0,
        styleCount: result.styles ? Object.keys(result.styles).length : 0,
        branches: result.branches?.length || 0,
      };

      print(output, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('nodes <fileKey>')
  .description('Get specific nodes from a file')
  .requiredOption('--ids <ids>', 'Comma-separated node IDs')
  .option('-v, --version <version>', 'Specific version')
  .option('-d, --depth <depth>', 'Depth to retrieve')
  .action(async (fileKey: string, opts: { ids: string; version?: string; depth?: string }) => {
    try {
      const client = getClient();
      const nodeIds = opts.ids.split(',').map(id => id.trim());
      const result = await client.files.getFileNodes(fileKey, nodeIds, {
        version: opts.version,
        depth: opts.depth ? parseInt(opts.depth) : undefined,
      });

      print(result, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('images <fileKey>')
  .description('Export images from a file')
  .requiredOption('--ids <ids>', 'Comma-separated node IDs to export')
  .option('--format <format>', 'Export format (png, jpg, svg, pdf)', 'png')
  .option('--scale <scale>', 'Scale factor (0.01 to 4)', '1')
  .option('--output <file>', 'Save URLs to a file')
  .action(async (fileKey: string, opts: { ids: string; format?: string; scale?: string; output?: string }) => {
    try {
      const client = getClient();
      const nodeIds = opts.ids.split(',').map(id => id.trim());
      const result = await client.files.getImages(fileKey, {
        ids: nodeIds,
        format: (opts.format || 'png') as ImageFormat,
        scale: opts.scale ? parseFloat(opts.scale) : 1,
      });

      if (result.err) {
        error(result.err);
        process.exit(1);
      }

      if (opts.output) {
        writeFileSync(opts.output, JSON.stringify(result.images, null, 2));
        success(`Image URLs saved to: ${opts.output}`);
      } else {
        print(result.images, getFormat(filesCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('versions <fileKey>')
  .description('Get file version history')
  .option('-n, --page-size <size>', 'Number of versions to retrieve')
  .action(async (fileKey: string, opts: { pageSize?: string }) => {
    try {
      const client = getClient();
      const result = await client.files.getVersions(fileKey, {
        page_size: opts.pageSize ? parseInt(opts.pageSize) : undefined,
      });

      const versions = result.versions.map(v => ({
        id: v.id,
        label: v.label || '(unnamed)',
        description: v.description || '',
        createdAt: v.created_at,
        user: v.user.handle,
      }));

      print(versions, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('meta <fileKey>')
  .description('Get file metadata (lightweight, without document tree)')
  .action(async (fileKey: string) => {
    try {
      const client = getClient();
      const result = await client.files.getFileMeta(fileKey);

      print({
        name: result.name,
        lastModified: result.lastModified,
        version: result.version,
        editorType: result.editorType,
        thumbnailUrl: result.thumbnailUrl,
        role: result.role,
        folderName: result.folderName,
        linkAccess: result.linkAccess,
        createdAt: result.createdAt,
        branches: result.branches?.length || 0,
      }, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Comments Commands
// ============================================
const commentsCmd = program
  .command('comments')
  .description('Comment operations');

commentsCmd
  .command('list <fileKey>')
  .description('List comments on a file')
  .action(async (fileKey: string) => {
    try {
      const client = getClient();
      const result = await client.comments.listComments(fileKey);

      const comments = result.comments.map(c => ({
        id: c.id,
        user: c.user.handle,
        message: c.message,
        createdAt: c.created_at,
        resolved: c.resolved_at ? 'Yes' : 'No',
        parentId: c.parent_id || null,
      }));

      print(comments, getFormat(commentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentsCmd
  .command('post <fileKey> <message>')
  .description('Post a comment on a file')
  .option('--reply-to <commentId>', 'Reply to an existing comment')
  .option('--node <nodeId>', 'Attach comment to a specific node')
  .option('-x <x>', 'X coordinate for the comment')
  .option('-y <y>', 'Y coordinate for the comment')
  .action(async (fileKey: string, message: string, opts: { replyTo?: string; node?: string; x?: string; y?: string }) => {
    try {
      const client = getClient();

      const clientMeta = opts.node || opts.x || opts.y ? {
        node_id: opts.node,
        x: opts.x ? parseFloat(opts.x) : undefined,
        y: opts.y ? parseFloat(opts.y) : undefined,
      } : undefined;

      const result = await client.comments.postComment(fileKey, message, {
        comment_id: opts.replyTo,
        client_meta: clientMeta,
      });

      success(`Comment posted (ID: ${result.id})`);
      print({
        id: result.id,
        message: result.message,
        user: result.user.handle,
        createdAt: result.created_at,
      }, getFormat(commentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentsCmd
  .command('delete <fileKey> <commentId>')
  .description('Delete a comment')
  .action(async (fileKey: string, commentId: string) => {
    try {
      const client = getClient();
      await client.comments.deleteComment(fileKey, commentId);
      success(`Comment ${commentId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Teams Commands
// ============================================
const teamsCmd = program
  .command('teams')
  .description('Team operations');

teamsCmd
  .command('projects <teamId>')
  .description('List team projects')
  .action(async (teamId: string) => {
    try {
      const client = getClient();
      const result = await client.teams.getProjects(teamId);

      success(`Team: ${result.name}`);
      const projects = result.projects.map(p => ({
        id: p.id,
        name: p.name,
      }));

      print(projects, getFormat(teamsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Projects Commands
// ============================================
const projectsCmd = program
  .command('projects')
  .description('Project operations');

projectsCmd
  .command('list <teamId>')
  .description('List team projects')
  .action(async (teamId: string) => {
    try {
      const client = getClient();
      const result = await client.projects.getTeamProjects(teamId);

      success(`Team: ${result.name}`);
      const projects = result.projects.map(p => ({
        id: p.id,
        name: p.name,
      }));

      print(projects, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('files <projectId>')
  .description('List files in a project')
  .option('--branches', 'Include branch data')
  .action(async (projectId: string, opts: { branches?: boolean }) => {
    try {
      const client = getClient();
      const result = await client.projects.getProjectFiles(projectId, {
        branch_data: opts.branches,
      });

      success(`Project: ${result.name}`);
      const files = result.files.map(f => ({
        key: f.key,
        name: f.name,
        lastModified: f.last_modified,
        thumbnailUrl: f.thumbnail_url,
      }));

      print(files, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Components Commands
// ============================================
const componentsCmd = program
  .command('components')
  .description('Component operations');

componentsCmd
  .command('team <teamId>')
  .description('List team components')
  .option('-n, --page-size <size>', 'Number of components to retrieve')
  .action(async (teamId: string, opts: { pageSize?: string }) => {
    try {
      const client = getClient();
      const result = await client.components.getTeamComponents(teamId, {
        page_size: opts.pageSize ? parseInt(opts.pageSize) : undefined,
      });

      if (result.error) {
        error('Failed to fetch components');
        process.exit(1);
      }

      const components = result.meta?.components.map(c => ({
        key: c.key,
        name: c.name,
        description: c.description || '',
        fileKey: c.file_key,
        thumbnailUrl: c.thumbnail_url,
      })) || [];

      print(components, getFormat(componentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

componentsCmd
  .command('file <fileKey>')
  .description('List components in a file')
  .action(async (fileKey: string) => {
    try {
      const client = getClient();
      const result = await client.components.getFileComponents(fileKey);

      const components = result.meta.components.map(c => ({
        key: c.key,
        name: c.name,
        description: c.description || '',
        nodeId: c.node_id,
      }));

      print(components, getFormat(componentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

componentsCmd
  .command('sets <teamId>')
  .description('List team component sets')
  .option('-n, --page-size <size>', 'Number of component sets to retrieve')
  .action(async (teamId: string, opts: { pageSize?: string }) => {
    try {
      const client = getClient();
      const result = await client.components.getTeamComponentSets(teamId, {
        page_size: opts.pageSize ? parseInt(opts.pageSize) : undefined,
      });

      if (result.error) {
        error('Failed to fetch component sets');
        process.exit(1);
      }

      const sets = result.meta?.component_sets.map(c => ({
        key: c.key,
        name: c.name,
        description: c.description || '',
        fileKey: c.file_key,
      })) || [];

      print(sets, getFormat(componentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Styles Commands
// ============================================
const stylesCmd = program
  .command('styles')
  .description('Style operations');

stylesCmd
  .command('team <teamId>')
  .description('List team styles')
  .option('-n, --page-size <size>', 'Number of styles to retrieve')
  .action(async (teamId: string, opts: { pageSize?: string }) => {
    try {
      const client = getClient();
      const result = await client.styles.getTeamStyles(teamId, {
        page_size: opts.pageSize ? parseInt(opts.pageSize) : undefined,
      });

      if (result.error) {
        error('Failed to fetch styles');
        process.exit(1);
      }

      const styles = result.meta?.styles.map(s => ({
        key: s.key,
        name: s.name,
        type: s.style_type,
        description: s.description || '',
        fileKey: s.file_key,
      })) || [];

      print(styles, getFormat(stylesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

stylesCmd
  .command('file <fileKey>')
  .description('List styles in a file')
  .action(async (fileKey: string) => {
    try {
      const client = getClient();
      const result = await client.styles.getFileStyles(fileKey);

      const styles = result.meta.styles.map(s => ({
        key: s.key,
        name: s.name,
        type: s.style_type,
        description: s.description || '',
        nodeId: s.node_id,
      }));

      print(styles, getFormat(stylesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Webhooks Commands
// ============================================
const webhooksCmd = program
  .command('webhooks')
  .description('Webhook operations');

webhooksCmd
  .command('list <teamId>')
  .description('List team webhooks')
  .action(async (teamId: string) => {
    try {
      const client = getClient();
      const result = await client.webhooks.getTeamWebhooks(teamId);

      const hooks = result.webhooks.map(w => ({
        id: w.id,
        eventType: w.event_type,
        status: w.status,
        endpoint: w.endpoint,
        description: w.description || '',
      }));

      print(hooks, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create <teamId>')
  .description('Create a webhook')
  .requiredOption('-e, --event <type>', 'Event type (FILE_UPDATE, FILE_DELETE, FILE_VERSION_UPDATE, LIBRARY_PUBLISH, FILE_COMMENT)')
  .requiredOption('-u, --endpoint <url>', 'Webhook endpoint URL')
  .requiredOption('--passcode <passcode>', 'Passcode for webhook verification')
  .option('-d, --description <desc>', 'Webhook description')
  .action(async (teamId: string, opts: { event: string; endpoint: string; passcode: string; description?: string }) => {
    try {
      const client = getClient();
      const result = await client.webhooks.createWebhook(teamId, {
        event_type: opts.event as 'FILE_UPDATE' | 'FILE_DELETE' | 'FILE_VERSION_UPDATE' | 'LIBRARY_PUBLISH' | 'FILE_COMMENT',
        endpoint: opts.endpoint,
        passcode: opts.passcode,
        description: opts.description,
      });

      success(`Webhook created (ID: ${result.id})`);
      print({
        id: result.id,
        eventType: result.event_type,
        status: result.status,
        endpoint: result.endpoint,
      }, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <webhookId>')
  .description('Delete a webhook')
  .action(async (webhookId: string) => {
    try {
      const client = getClient();
      await client.webhooks.deleteWebhook(webhookId);
      success(`Webhook ${webhookId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('update <webhookId>')
  .description('Update a webhook')
  .option('-e, --event <type>', 'Event type')
  .option('-u, --endpoint <url>', 'Webhook endpoint URL')
  .option('--passcode <passcode>', 'Passcode')
  .option('-s, --status <status>', 'Status (ACTIVE, PAUSED)')
  .option('-d, --description <desc>', 'Description')
  .action(async (webhookId: string, opts: { event?: string; endpoint?: string; passcode?: string; status?: string; description?: string }) => {
    try {
      const client = getClient();
      const result = await client.webhooks.updateWebhook(webhookId, {
        event_type: opts.event as 'FILE_UPDATE' | 'FILE_DELETE' | 'FILE_VERSION_UPDATE' | 'LIBRARY_PUBLISH' | 'FILE_COMMENT' | undefined,
        endpoint: opts.endpoint,
        passcode: opts.passcode,
        status: opts.status as 'ACTIVE' | 'PAUSED' | undefined,
        description: opts.description,
      });

      success(`Webhook ${webhookId} updated`);
      print({
        id: result.id,
        eventType: result.event_type,
        status: result.status,
        endpoint: result.endpoint,
      }, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Variables Commands
// ============================================
const variablesCmd = program
  .command('variables')
  .description('Variables operations');

variablesCmd
  .command('local <fileKey>')
  .description('Get local variables in a file')
  .action(async (fileKey: string) => {
    try {
      const client = getClient();
      const result = await client.variables.getLocalVariables(fileKey);

      if (result.error) {
        error('Failed to fetch variables');
        process.exit(1);
      }

      const variables = Object.values(result.meta?.variables || {}).map(v => ({
        id: v.id,
        name: v.name,
        key: v.key,
        type: v.resolvedType,
        collectionId: v.variableCollectionId,
        description: v.description || '',
        remote: v.remote || false,
      }));

      print(variables, getFormat(variablesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

variablesCmd
  .command('collections <fileKey>')
  .description('Get variable collections in a file')
  .action(async (fileKey: string) => {
    try {
      const client = getClient();
      const result = await client.variables.getLocalVariables(fileKey);

      if (result.error) {
        error('Failed to fetch variable collections');
        process.exit(1);
      }

      const collections = Object.values(result.meta?.variableCollections || {}).map(c => ({
        id: c.id,
        name: c.name,
        key: c.key,
        modes: c.modes.map(m => m.name).join(', '),
        defaultModeId: c.defaultModeId,
        variableCount: c.variableIds?.length || 0,
        remote: c.remote || false,
      }));

      print(collections, getFormat(variablesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

variablesCmd
  .command('published <fileKey>')
  .description('Get published variables in a file')
  .action(async (fileKey: string) => {
    try {
      const client = getClient();
      const result = await client.variables.getPublishedVariables(fileKey);

      if (result.error) {
        error('Failed to fetch published variables');
        process.exit(1);
      }

      const variables = Object.values(result.meta?.variables || {}).map(v => ({
        id: v.id,
        name: v.name,
        key: v.key,
        type: v.resolvedType,
        collectionId: v.variableCollectionId,
        description: v.description || '',
      }));

      print(variables, getFormat(variablesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Dev Resources Commands
// ============================================
const devResourcesCmd = program
  .command('dev-resources')
  .description('Dev resources operations');

devResourcesCmd
  .command('list <fileKey>')
  .description('List dev resources for a file')
  .option('--node-ids <ids>', 'Filter by comma-separated node IDs')
  .action(async (fileKey: string, opts: { nodeIds?: string }) => {
    try {
      const client = getClient();
      const nodeIds = opts.nodeIds ? opts.nodeIds.split(',').map(id => id.trim()) : undefined;
      const result = await client.devResources.getDevResources(fileKey, nodeIds);

      const resources = result.dev_resources.map(r => ({
        id: r.id,
        name: r.name,
        url: r.url,
        nodeId: r.node_id,
      }));

      print(resources, getFormat(devResourcesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

devResourcesCmd
  .command('create <fileKey>')
  .description('Create a dev resource')
  .requiredOption('-n, --name <name>', 'Resource name')
  .requiredOption('-u, --url <url>', 'Resource URL')
  .requiredOption('--node-id <nodeId>', 'Node ID to attach the resource to')
  .action(async (fileKey: string, opts: { name: string; url: string; nodeId: string }) => {
    try {
      const client = getClient();
      const result = await client.devResources.createDevResources(fileKey, [{
        name: opts.name,
        url: opts.url,
        file_key: fileKey,
        node_id: opts.nodeId,
      }]);

      success('Dev resource created');
      if (result.dev_resources.length > 0) {
        const resource = result.dev_resources[0];
        print({
          id: resource.id,
          name: resource.name,
          url: resource.url,
          nodeId: resource.node_id,
        }, getFormat(devResourcesCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

devResourcesCmd
  .command('delete <fileKey> <resourceId>')
  .description('Delete a dev resource')
  .action(async (fileKey: string, resourceId: string) => {
    try {
      const client = getClient();
      await client.devResources.deleteDevResource(fileKey, resourceId);
      success(`Dev resource ${resourceId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .description('User operations');

userCmd
  .command('me')
  .description('Get current user info')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.users.getMe();

      print({
        id: result.id,
        handle: result.handle,
        email: result.email,
        imgUrl: result.img_url,
      }, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
