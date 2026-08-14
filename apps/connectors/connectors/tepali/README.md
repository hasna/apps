# @hasna/connect-tepali

A TypeScript connector CLI and library for the [Tepali](https://www.tepali.com/)
API — the medspa (medical spa) operating system for aesthetics and wellness
businesses. Manage patients, appointments, treatments, clinical charting,
inventory, and leads from the command line or programmatically.

## Installation

```bash
bun install
```

Or install the published package:

```bash
npm install -g @hasna/connect-tepali
```

## Authentication

Tepali uses Bearer token authentication. Provide your API key via an environment
variable, a stored profile, or a command-line flag.

```bash
# Environment variable
export TEPALI_API_KEY="your-api-key"

# Optional: override the base URL (defaults to https://api.tepali.com/v1)
export TEPALI_BASE_URL="https://api.tepali.com/v1"

# Or store it in the active profile
connect-tepali config set-key your-api-key
```

Copy `.env.example` to `.env` and fill in your key for local development.

## CLI Usage

```bash
connect-tepali [options] [command]

Global options:
  -k, --api-key <key>      API key (overrides config)
  -b, --base-url <url>     API base URL (overrides config)
  -f, --format <format>    Output format: json, table, pretty (default: pretty)
  -p, --profile <profile>  Use a specific profile
  -v, --verbose            Enable verbose output
```

### Patients

```bash
connect-tepali list-patients --status active --per-page 50
connect-tepali get-patient pat_123
```

### Appointments

```bash
connect-tepali list-appointments --patient-id pat_123 --starts-after 2026-07-01T00:00:00Z
connect-tepali create-appointment \
  --patient-id pat_123 \
  --starts-at 2026-07-10T15:00:00Z \
  --treatment-id trt_botox \
  --provider-id prov_1
```

### Treatments

```bash
connect-tepali list-treatments --active --category injectables
```

### Charting

```bash
connect-tepali create-chart \
  --patient-id pat_123 \
  --appointment-id appt_456 \
  --type soap \
  --content "S: ... O: ... A: ... P: ..."
```

### Inventory

```bash
connect-tepali list-inventory --low-stock
```

### Leads

```bash
connect-tepali list-leads --status new --source meta
```

### Raw requests

For endpoints not yet wrapped by a dedicated command:

```bash
connect-tepali raw-request /reports/revenue --method GET --param month=2026-07
connect-tepali raw-request /patients --method POST --data '{"first_name":"Ada","last_name":"Lovelace"}'
```

## Library Usage

```ts
import { Tepali } from '@hasna/connect-tepali';

const tepali = new Tepali({ apiKey: process.env.TEPALI_API_KEY! });
// or: const tepali = Tepali.fromEnv();

const patients = await tepali.patients.list({ status: 'active', per_page: 50 });
const appointment = await tepali.appointments.create({
  patient_id: 'pat_123',
  starts_at: '2026-07-10T15:00:00Z',
});

// Arbitrary passthrough request
const revenue = await tepali.raw('/reports/revenue', { params: { month: '2026-07' } });
```

## Project Structure

```
src/
├── api/
│   ├── client.ts        # HTTP client (Bearer auth, retry/backoff)
│   ├── patients.ts      # Patients resource
│   ├── appointments.ts  # Appointments resource
│   ├── treatments.ts    # Treatments resource
│   ├── charts.ts        # Charting resource
│   ├── inventory.ts     # Inventory resource
│   ├── leads.ts         # Leads resource
│   └── index.ts         # Tepali facade + raw passthrough
├── cli/
│   └── index.ts         # CLI commands (Commander.js)
├── types/
│   └── index.ts         # Type definitions
├── utils/
│   ├── config.ts        # Multi-profile configuration
│   ├── auth.ts          # Credential resolution + auth headers
│   └── output.ts        # CLI output formatting
└── index.ts             # Library exports
```

## Development

```bash
bun install       # Install dependencies
bun run dev       # Run CLI in development
bun run build     # Build for distribution
bun run typecheck # Type check
bun test          # Run tests
```

## License

Apache-2.0
