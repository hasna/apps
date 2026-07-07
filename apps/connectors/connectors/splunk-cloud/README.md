# @hasna/connect-splunk-cloud

A TypeScript connector and CLI for the [Splunk Cloud Platform](https://docs.splunk.com/Documentation/SplunkCloud) REST management API (`splunkd`, `/services/*`). Manage search jobs, saved searches, indexes, HTTP Event Collector (HEC) tokens, users, roles, messages, fired alerts, and installed apps.

## Features

- Talks directly to the Splunk Cloud stack management endpoint (port `8089`)
- Bearer token **or** username/password (Basic) authentication
- Requests JSON output automatically (`output_mode=json`)
- Retry with exponential backoff on `429`/`5xx`, configurable timeout
- Multi-profile configuration
- Pretty, table, and JSON output formats
- Library + CLI (`connect-splunk-cloud`)

## Install

```bash
bun install
bun run build
```

## Configuration

Set credentials via environment variables (see `.env.example`) or the config store:

```bash
export SPLUNK_CLOUD_BASE_URL="https://<stack>.splunkcloud.com:8089"
export SPLUNK_CLOUD_TOKEN="<your-token>"
# or, for Basic auth:
# export SPLUNK_CLOUD_USERNAME="<user>"
# export SPLUNK_CLOUD_PASSWORD="<password>"
```

Or store them in a profile:

```bash
connect-splunk-cloud config set-base-url "https://<stack>.splunkcloud.com:8089"
connect-splunk-cloud config set-token "<your-token>"
```

## CLI Usage

```bash
# Server
connect-splunk-cloud server info
connect-splunk-cloud server health

# Search jobs
connect-splunk-cloud search create "index=_internal | head 10" --earliest -24h --latest now
connect-splunk-cloud search list
connect-splunk-cloud search get <sid>
connect-splunk-cloud search results <sid> --count 100
connect-splunk-cloud search finalize <sid>
connect-splunk-cloud search delete <sid>

# Saved searches
connect-splunk-cloud saved list
connect-splunk-cloud saved create my_alert "index=main error" --cron "*/5 * * * *"

# Indexes
connect-splunk-cloud index list
connect-splunk-cloud index create my_index --max-size 10000 --datatype event

# HEC tokens
connect-splunk-cloud hec list
connect-splunk-cloud hec create my_token --index main --sourcetype json

# Users & roles
connect-splunk-cloud user list
connect-splunk-cloud role list

# Messages, alerts, apps
connect-splunk-cloud message list
connect-splunk-cloud alerts
connect-splunk-cloud apps

# JSON output
connect-splunk-cloud --format json server info
```

## Library Usage

```ts
import { SplunkCloud } from '@hasna/connect-splunk-cloud';

const splunk = SplunkCloud.fromEnv(); // reads SPLUNK_CLOUD_* env vars

const info = await splunk.getServerInfo();
console.log(info.version);

const { sid } = await splunk.createSearchJob({
  search: 'index=_internal | stats count by sourcetype',
  earliestTime: '-1h',
  execMode: 'normal',
});

const results = await splunk.getSearchResults(sid, { count: 100 });
console.log(results.results);
```

## Development

```bash
bun install
bun run dev <command>   # run the CLI from source
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
