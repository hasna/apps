# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-tepali is a TypeScript connector for the Tepali API. Tepali is a medspa
(medical spa) operating system covering patients, appointments, treatments,
clinical charting, inventory, and lead management. This package provides a CLI
and a library for interacting with the Tepali REST API.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run tests
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://api.tepali.com/v1` (override with `TEPALI_BASE_URL`)
- **Auth**: Bearer token: `Authorization: Bearer YOUR_API_KEY`
- **Pagination**: `page` (1-indexed), `per_page`
- **Docs**: https://www.tepali.com/

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Patients | `GET /patients`, `GET /patients/{id}` | Patient records (CRM/EMR) |
| Appointments | `GET /appointments`, `POST /appointments` | Provider-aware scheduling |
| Treatments | `GET /treatments` | Treatment/service catalog |
| Charts | `POST /charts` | Clinical documentation (SOAP notes, summaries) |
| Inventory | `GET /inventory` | Injectables, devices, and consumables |
| Leads | `GET /leads` | Marketing lead management |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TEPALI_API_KEY` | API key (Bearer token) |
| `TEPALI_BASE_URL` | Override base URL (optional) |

## CLI Commands

```bash
connect-tepali list-patients                 # List patients
connect-tepali get-patient <id>              # Get a patient by ID
connect-tepali list-appointments             # List appointments
connect-tepali create-appointment            # Create an appointment
connect-tepali list-treatments               # List treatments
connect-tepali create-chart                  # Create a clinical chart note
connect-tepali list-inventory                # List inventory items
connect-tepali list-leads                    # List leads
connect-tepali raw-request <path>            # Arbitrary authenticated request
connect-tepali config set-key <key>          # Set API key
connect-tepali config set-base-url <url>     # Set base URL
connect-tepali profile list                  # List profiles
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
