#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { GitHub } from '../api';
import {
  getToken,
  setToken,
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

const CONNECTOR_NAME = 'connect-github';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('GitHub API connector CLI')
  .version(VERSION)
  .option('-t, --token <token>', 'GitHub token (overrides config)')
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
    // Set token from flag if provided
    if (opts.token) {
      process.env.GITHUB_TOKEN = opts.token;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): GitHub {
  const token = getToken();
  if (!token) {
    error(`No GitHub token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set GITHUB_TOKEN environment variable.`);
    process.exit(1);
  }
  return new GitHub({ token });
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
  .option('--token <token>', 'GitHub token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      token: opts.token,
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
    info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set GitHub token')
  .action((token: string) => {
    setToken(token);
    success(`Token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const token = getToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Repository Commands
// ============================================
const repoCmd = program
  .command('repo')
  .description('Manage repositories');

repoCmd
  .command('list [owner]')
  .description('List repositories for a user/org (defaults to authenticated user)')
  .option('--org', 'Treat owner as an organization')
  .option('-n, --per-page <number>', 'Results per page', '30')
  .option('--page <number>', 'Page number', '1')
  .option('--sort <sort>', 'Sort by: created, updated, pushed, full_name', 'updated')
  .action(async (owner: string | undefined, opts) => {
    try {
      const client = getClient();
      let repos;

      if (!owner) {
        repos = await client.repos.listForAuthenticatedUser({
          per_page: parseInt(opts.perPage),
          page: parseInt(opts.page),
          sort: opts.sort,
        });
      } else if (opts.org) {
        repos = await client.repos.listOrg(owner, {
          per_page: parseInt(opts.perPage),
          page: parseInt(opts.page),
          sort: opts.sort,
        });
      } else {
        repos = await client.repos.list(owner, {
          per_page: parseInt(opts.perPage),
          page: parseInt(opts.page),
          sort: opts.sort,
        });
      }

      if (getFormat(repoCmd) === 'json') {
        print(repos, 'json');
      } else {
        if (repos.length === 0) {
          info('No repositories found');
          return;
        }
        repos.forEach(repo => {
          const visibility = repo.private ? chalk.yellow('private') : chalk.green('public');
          const stars = repo.stargazers_count > 0 ? chalk.yellow(`* ${repo.stargazers_count}`) : '';
          console.log(`${chalk.cyan(repo.full_name)} ${visibility} ${stars}`);
          if (repo.description) {
            console.log(`  ${chalk.gray(repo.description)}`);
          }
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

repoCmd
  .command('get <owner> <repo>')
  .description('Get repository information')
  .action(async (owner: string, repo: string) => {
    try {
      const client = getClient();
      const result = await client.repos.get(owner, repo);
      print(result, getFormat(repoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

repoCmd
  .command('create <name>')
  .description('Create a new repository')
  .option('-d, --description <description>', 'Repository description')
  .option('--private', 'Create as private repository')
  .option('--org <org>', 'Create in an organization')
  .option('--auto-init', 'Initialize with README')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      let result;

      const options = {
        description: opts.description,
        private: opts.private,
        auto_init: opts.autoInit,
      };

      if (opts.org) {
        result = await client.repos.createInOrg(opts.org, name, options);
      } else {
        result = await client.repos.create(name, options);
      }

      success(`Repository created: ${result.html_url}`);
      print(result, getFormat(repoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

repoCmd
  .command('delete <owner> <repo>')
  .description('Delete a repository')
  .action(async (owner: string, repo: string) => {
    try {
      const client = getClient();
      await client.repos.delete(owner, repo);
      success(`Repository ${owner}/${repo} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

repoCmd
  .command('content <owner> <repo> <path>')
  .description('Get file or directory content')
  .option('--ref <ref>', 'Git ref (branch, tag, commit)')
  .action(async (owner: string, repo: string, path: string, opts) => {
    try {
      const client = getClient();
      const result = await client.repos.getContent(owner, repo, path, { ref: opts.ref });

      // If it's a file with content, decode and display
      if (!Array.isArray(result) && result.type === 'file' && result.content) {
        if (getFormat(repoCmd) === 'json') {
          print(result, 'json');
        } else {
          const content = Buffer.from(result.content, 'base64').toString('utf-8');
          console.log(content);
        }
      } else {
        print(result, getFormat(repoCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Issue Commands
// ============================================
const issueCmd = program
  .command('issue')
  .description('Manage issues');

issueCmd
  .command('list <owner> <repo>')
  .description('List issues in a repository')
  .option('--state <state>', 'Filter by state: open, closed, all', 'open')
  .option('--labels <labels>', 'Filter by labels (comma-separated)')
  .option('-n, --per-page <number>', 'Results per page', '30')
  .option('--page <number>', 'Page number', '1')
  .action(async (owner: string, repo: string, opts) => {
    try {
      const client = getClient();
      const issues = await client.issues.list(owner, repo, {
        state: opts.state,
        labels: opts.labels,
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });

      if (getFormat(issueCmd) === 'json') {
        print(issues, 'json');
      } else {
        if (issues.length === 0) {
          info('No issues found');
          return;
        }
        issues.forEach(issue => {
          const state = issue.state === 'open' ? chalk.green('open') : chalk.red('closed');
          const labels = issue.labels.map(l => chalk.cyan(l.name)).join(', ');
          console.log(`#${issue.number} ${state} ${chalk.bold(issue.title)}`);
          if (labels) console.log(`  Labels: ${labels}`);
          if (issue.assignee) console.log(`  Assignee: ${chalk.yellow(issue.assignee.login)}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issueCmd
  .command('get <owner> <repo> <number>')
  .description('Get an issue')
  .action(async (owner: string, repo: string, number: string) => {
    try {
      const client = getClient();
      const result = await client.issues.get(owner, repo, parseInt(number));
      print(result, getFormat(issueCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issueCmd
  .command('create <owner> <repo>')
  .description('Create an issue')
  .requiredOption('-t, --title <title>', 'Issue title')
  .option('-b, --body <body>', 'Issue body')
  .option('--labels <labels>', 'Labels (comma-separated)')
  .option('--assignees <assignees>', 'Assignees (comma-separated)')
  .action(async (owner: string, repo: string, opts) => {
    try {
      const client = getClient();
      const result = await client.issues.create(owner, repo, opts.title, opts.body, {
        labels: opts.labels?.split(',').map((l: string) => l.trim()),
        assignees: opts.assignees?.split(',').map((a: string) => a.trim()),
      });
      success(`Issue created: ${result.html_url}`);
      print(result, getFormat(issueCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issueCmd
  .command('close <owner> <repo> <number>')
  .description('Close an issue')
  .option('--reason <reason>', 'Close reason: completed, not_planned', 'completed')
  .action(async (owner: string, repo: string, number: string, opts) => {
    try {
      const client = getClient();
      await client.issues.update(owner, repo, parseInt(number), {
        state: 'closed',
        state_reason: opts.reason,
      });
      success(`Issue #${number} closed`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issueCmd
  .command('comment <owner> <repo> <number>')
  .description('Add a comment to an issue')
  .requiredOption('-b, --body <body>', 'Comment body')
  .action(async (owner: string, repo: string, number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.issues.createComment(owner, repo, parseInt(number), opts.body);
      success(`Comment added: ${result.html_url}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issueCmd
  .command('comments <owner> <repo> <number>')
  .description('List comments on an issue')
  .action(async (owner: string, repo: string, number: string) => {
    try {
      const client = getClient();
      const comments = await client.issues.listComments(owner, repo, parseInt(number));

      if (getFormat(issueCmd) === 'json') {
        print(comments, 'json');
      } else {
        if (comments.length === 0) {
          info('No comments');
          return;
        }
        comments.forEach(comment => {
          console.log(`${chalk.cyan(comment.user.login)} ${chalk.gray(comment.created_at)}`);
          console.log(`  ${comment.body}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Pull Request Commands
// ============================================
const prCmd = program
  .command('pr')
  .description('Manage pull requests');

prCmd
  .command('list <owner> <repo>')
  .description('List pull requests')
  .option('--state <state>', 'Filter by state: open, closed, all', 'open')
  .option('--base <base>', 'Filter by base branch')
  .option('--head <head>', 'Filter by head branch')
  .option('-n, --per-page <number>', 'Results per page', '30')
  .option('--page <number>', 'Page number', '1')
  .action(async (owner: string, repo: string, opts) => {
    try {
      const client = getClient();
      const prs = await client.pulls.list(owner, repo, {
        state: opts.state,
        base: opts.base,
        head: opts.head,
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });

      if (getFormat(prCmd) === 'json') {
        print(prs, 'json');
      } else {
        if (prs.length === 0) {
          info('No pull requests found');
          return;
        }
        prs.forEach(pr => {
          const state = pr.state === 'open' ? chalk.green('open') : chalk.red('closed');
          const merged = pr.merged ? chalk.magenta(' [merged]') : '';
          const draft = pr.draft ? chalk.gray(' [draft]') : '';
          console.log(`#${pr.number} ${state}${merged}${draft} ${chalk.bold(pr.title)}`);
          console.log(`  ${chalk.cyan(pr.head.ref)} -> ${chalk.cyan(pr.base.ref)}`);
          if (pr.user) console.log(`  Author: ${chalk.yellow(pr.user.login)}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

prCmd
  .command('get <owner> <repo> <number>')
  .description('Get a pull request')
  .action(async (owner: string, repo: string, number: string) => {
    try {
      const client = getClient();
      const result = await client.pulls.get(owner, repo, parseInt(number));
      print(result, getFormat(prCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

prCmd
  .command('create <owner> <repo>')
  .description('Create a pull request')
  .requiredOption('-t, --title <title>', 'PR title')
  .requiredOption('--head <head>', 'Head branch')
  .requiredOption('--base <base>', 'Base branch')
  .option('-b, --body <body>', 'PR body')
  .option('--draft', 'Create as draft')
  .action(async (owner: string, repo: string, opts) => {
    try {
      const client = getClient();
      const result = await client.pulls.create(
        owner,
        repo,
        opts.title,
        opts.head,
        opts.base,
        opts.body,
        { draft: opts.draft }
      );
      success(`Pull request created: ${result.html_url}`);
      print(result, getFormat(prCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

prCmd
  .command('merge <owner> <repo> <number>')
  .description('Merge a pull request')
  .option('--method <method>', 'Merge method: merge, squash, rebase', 'merge')
  .option('--title <title>', 'Commit title')
  .option('--message <message>', 'Commit message')
  .action(async (owner: string, repo: string, number: string, opts) => {
    try {
      const client = getClient();
      const result = await client.pulls.merge(owner, repo, parseInt(number), {
        merge_method: opts.method,
        commit_title: opts.title,
        commit_message: opts.message,
      });
      if (result.merged) {
        success(`Pull request #${number} merged`);
      } else {
        warn(`Merge result: ${result.message}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

prCmd
  .command('reviews <owner> <repo> <number>')
  .description('List reviews on a pull request')
  .action(async (owner: string, repo: string, number: string) => {
    try {
      const client = getClient();
      const reviews = await client.pulls.listReviews(owner, repo, parseInt(number));

      if (getFormat(prCmd) === 'json') {
        print(reviews, 'json');
      } else {
        if (reviews.length === 0) {
          info('No reviews');
          return;
        }
        reviews.forEach(review => {
          const stateColor =
            review.state === 'APPROVED'
              ? chalk.green
              : review.state === 'CHANGES_REQUESTED'
                ? chalk.red
                : chalk.gray;
          console.log(`${chalk.cyan(review.user.login)} ${stateColor(review.state)}`);
          if (review.body) console.log(`  ${review.body}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

prCmd
  .command('review <owner> <repo> <number>')
  .description('Create a review on a pull request')
  .option('-b, --body <body>', 'Review body')
  .option('--approve', 'Approve the PR')
  .option('--request-changes', 'Request changes')
  .option('--comment', 'Just comment (no approval)')
  .action(async (owner: string, repo: string, number: string, opts) => {
    try {
      const client = getClient();
      let event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' = 'COMMENT';
      if (opts.approve) event = 'APPROVE';
      if (opts.requestChanges) event = 'REQUEST_CHANGES';

      const result = await client.pulls.createReview(
        owner,
        repo,
        parseInt(number),
        opts.body,
        event
      );
      success(`Review submitted: ${result.state}`);
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
  .description('User information');

userCmd
  .command('info [username]')
  .description('Get user information (defaults to authenticated user)')
  .action(async (username?: string) => {
    try {
      const client = getClient();
      const result = username
        ? await client.users.get(username)
        : await client.users.getAuthenticated();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('followers [username]')
  .description('List followers')
  .option('-n, --per-page <number>', 'Results per page', '30')
  .action(async (username: string | undefined, opts) => {
    try {
      const client = getClient();
      const followers = username
        ? await client.users.listFollowers(username, { per_page: parseInt(opts.perPage) })
        : await client.users.listMyFollowers({ per_page: parseInt(opts.perPage) });

      if (getFormat(userCmd) === 'json') {
        print(followers, 'json');
      } else {
        if (followers.length === 0) {
          info('No followers');
          return;
        }
        followers.forEach(user => {
          console.log(`${chalk.cyan(user.login)}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('following [username]')
  .description('List users being followed')
  .option('-n, --per-page <number>', 'Results per page', '30')
  .action(async (username: string | undefined, opts) => {
    try {
      const client = getClient();
      const following = username
        ? await client.users.listFollowing(username, { per_page: parseInt(opts.perPage) })
        : await client.users.listMyFollowing({ per_page: parseInt(opts.perPage) });

      if (getFormat(userCmd) === 'json') {
        print(following, 'json');
      } else {
        if (following.length === 0) {
          info('Not following anyone');
          return;
        }
        following.forEach(user => {
          console.log(`${chalk.cyan(user.login)}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
