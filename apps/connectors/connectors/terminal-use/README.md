# connect-terminal-use

TypeScript connector for the [Terminal Use](https://docs.terminaluse.com) API - deploy AI agents, manage tasks, stream events, and work with persistent filesystems.

## Install

```bash
bun install
```

## Configuration

```bash
export TERMINAL_USE_TOKEN=tu_your_token_here
# optional
export TERMINAL_USE_AGENT_API_KEY=your_agent_key
export TERMINAL_USE_BASE_URL=https://api.terminaluse.com
```

Or use the CLI profile/config commands:

```bash
bun run dev config set-key tu_your_token_here
bun run dev config set-agent-key your_agent_key
```

## Usage

```bash
bun run dev projects list
bun run dev agents list
bun run dev tasks create --agent-name my-ns/my-agent
bun run dev tasks stream --task-id <id> --raw
bun run dev filesystems list
```

## API modules

- `projects` - list, create
- `agents` - list, get, get-by-name, deploy
- `tasks` - list, create, get, cancel, send-text-event, send-data-event, stream
- `messages` - list, get (v2)
- `filesystems` - create, list, get, list-files, get-file, upload-url, download-url, sync-complete
- `rawRequest` - arbitrary relative-path API calls

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
