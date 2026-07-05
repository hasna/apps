# connect-visibl-semiconductors

Visibl Semiconductors API connector — chip design coordination (projects, drift cases, fix proposals, CI signals, tapeout readiness).

## Installation

```bash
bun install -g @hasna/connect-visibl-semiconductors
```

## Quick Start

```bash
# Set your API key
connect-visibl-semiconductors config set-key YOUR_API_KEY

# Or use environment variable
export VISIBL_SEMICONDUCTORS_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-visibl-semiconductors list-projects
connect-visibl-semiconductors get-project <projectId>
connect-visibl-semiconductors list-drift-cases
connect-visibl-semiconductors get-drift-case <caseId>
connect-visibl-semiconductors list-fix-proposals <caseId>
connect-visibl-semiconductors approve-fix-proposal <proposalId> [--body '{"reviewer":"alice"}']
connect-visibl-semiconductors sync-design-context <projectId> [--body '{"source":"rtl"}']
connect-visibl-semiconductors list-ci-signals
connect-visibl-semiconductors get-tapeout-readiness <projectId>
connect-visibl-semiconductors raw-request --path /projects [--method GET]
```

## Library Usage

```typescript
import { VisiblSemiconductors } from '@hasna/connect-visibl-semiconductors';

const client = new VisiblSemiconductors({ apiKey: 'YOUR_API_KEY' });
const projects = await client.listProjects({ status: 'active' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VISIBL_SEMICONDUCTORS_API_KEY` | API key (required) |
| `VISIBL_SEMICONDUCTORS_BASE_URL` | Override base URL (default: `https://api.visiblsemi.com/v1`) |

## License

Apache-2.0
