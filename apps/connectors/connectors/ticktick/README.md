# @hasna/connect-ticktick

TypeScript connector for the [TickTick Open API](https://developer.ticktick.com/). Manage projects and tasks from the CLI or as a library.

## Installation

```bash
bun install
```

## Authentication

TickTick uses OAuth2. Register an app at https://developer.ticktick.com/manage, complete authorization, then configure the access token:

```bash
connect-ticktick config set-token <your-access-token>
# or
export TICKTICK_ACCESS_TOKEN=<your-access-token>
```

## CLI Usage

```bash
# Projects
connect-ticktick project list
connect-ticktick project get <projectId>
connect-ticktick project data <projectId>
connect-ticktick project create "My Project"
connect-ticktick project update <projectId> --name "Renamed"
connect-ticktick project delete <projectId>

# Tasks
connect-ticktick task get <projectId> <taskId>
connect-ticktick task create "Buy milk" --project <projectId>
connect-ticktick task update <taskId> --title "Buy oat milk"
connect-ticktick task complete <projectId> <taskId>
connect-ticktick task delete <projectId> <taskId>

# Configuration
connect-ticktick config show
connect-ticktick profile list
```

## Library Usage

```typescript
import { TickTick } from '@hasna/connect-ticktick';

const ticktick = new TickTick({ accessToken: process.env.TICKTICK_ACCESS_TOKEN! });
const projects = await ticktick.listProjects();
const task = await ticktick.createTask({ title: 'Hello', projectId: projects[0].id });
```

## API Reference

| Operation | Method | Endpoint |
|-----------|--------|----------|
| List projects | GET | `/project` |
| Get project | GET | `/project/{id}` |
| Get project with data | GET | `/project/{id}/data` |
| Create project | POST | `/project` |
| Update project | POST | `/project/{id}` |
| Delete project | DELETE | `/project/{id}` |
| Get task | GET | `/project/{pid}/task/{tid}` |
| Create task | POST | `/task` |
| Update task | POST | `/task/{id}` |
| Complete task | POST | `/project/{pid}/task/{tid}/complete` |
| Delete task | DELETE | `/project/{pid}/task/{tid}` |

Task priority values: `0` (none), `1` (low), `3` (medium), `5` (high).

## License

Apache-2.0
