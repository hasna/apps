# connect-stainlessapi

Stainless API connector CLI - manage SDK builds, projects, and organizations.

Built against the public [Stainless REST API](https://www.stainless.com/docs/api)
(`https://api.stainless.com`, `/v0`).

## Installation

```bash
bun install -g @hasna/connect-stainlessapi
```

## Quick Start

```bash
# Set your API key
connect-stainlessapi config set-key YOUR_API_KEY

# Or use environment variables
export STAINLESS_API_KEY=YOUR_API_KEY
export STAINLESS_PROJECT=your_project_slug   # optional default project
```

Get an API key from the [Stainless dashboard](https://app.stainless.com/)
(Settings → API keys). Authentication uses the `x-stainless-api-key` header.

## CLI Commands

```bash
# Auth / config
connect-stainlessapi config set-key <key>
connect-stainlessapi config set-project <project>
connect-stainlessapi config set-environment <production|staging>
connect-stainlessapi config show

# Builds
connect-stainlessapi builds create -r <revision> [--project <p>] [-b branch] [-t typescript,python]
connect-stainlessapi builds get <buildId>
connect-stainlessapi builds list [--project <p>] [-l 20]
connect-stainlessapi builds diagnostics <buildId>

# Projects
connect-stainlessapi projects list [-o org]
connect-stainlessapi projects get [project]
connect-stainlessapi projects branches list [project]
connect-stainlessapi projects branches get <branch> [project]

# Orgs & user
connect-stainlessapi orgs list
connect-stainlessapi orgs get <org>
connect-stainlessapi whoami
connect-stainlessapi targets

# Profiles
connect-stainlessapi profile list|use|create|delete|show
```

Add `-f json` to any command for JSON output, or `-p <profile>` to use a
specific profile.

## Library Usage

```ts
import { Stainless } from '@hasna/connect-stainlessapi';

const client = Stainless.fromEnv(); // reads STAINLESS_API_KEY / STAINLESS_PROJECT

const build = await client.builds.create({ project: 'my-sdk', revision: 'main' });
console.log(build.id);

const user = await client.user.retrieve();
console.log(user.email);
```

## Development

```bash
bun install
bun run dev        # run the CLI locally
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
