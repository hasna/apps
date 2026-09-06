# @hasna/logs-sdk

Zero-dependency universal telemetry client for [`@hasna/logs`](https://www.npmjs.com/package/@hasna/logs).

[![npm](https://img.shields.io/npm/v/@hasna/logs-sdk)](https://www.npmjs.com/package/@hasna/logs-sdk)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](../LICENSE)

Runs in the browser, in Node, and in Bun. It has no runtime dependencies — it
talks to a `@hasna/logs` collector over `fetch`.

## Install

```bash
npm install @hasna/logs-sdk
# or
bun add @hasna/logs-sdk
```

## Quick start

`initUniversalLogs` detects the runtime and installs the matching collector —
browser instrumentation when `window` is present, process instrumentation
otherwise.

```ts
import { initUniversalLogs } from "@hasna/logs-sdk"

const controller = initUniversalLogs({
  projectId: "my-project",
  apiKey: process.env.HASNA_LOGS_API_KEY,
  url: process.env.HASNA_LOGS_API_URL, // or HASNA_LOGS_API_URL later in this file's env table
  environment: "production",
  captureExceptions: true,
  captureRejections: true,
})
```

This SDK is deliberately ZERO-DEPENDENCY: it pushes telemetry to a
`@hasna/logs` collector (`logs-serve`) and reads NO environment of its own —
every option is an explicit argument, and nothing is attached automatically.
It is not a fleet client: it never resolves the `@hasna/contracts` credential
chain, and the browser build must never hold a full fleet key (pass a
write-scoped `browserToken` instead).

The collector URL defaults to `http://localhost:3460` when `url` is omitted.
That local collector requires the explicit local opt-in on the serve side
(`HASNA_LOGS_LOCAL=1 logs-serve`); pointing the SDK at a REMOTE collector
requires an API key via the `apiKey` option. The canonical env names to feed
the options are `HASNA_LOGS_API_URL` / `HASNA_LOGS_API_KEY`; the unprefixed
`LOGS_API_URL` / `LOGS_API_KEY` names are legacy aliases for one release.

Pass `browserToken` instead of `apiKey` in front-end code, so a write-scoped
token is shipped to the browser rather than a full API key.

## Direct client

`LogsClient` is the low-level API when you want to send explicitly rather than
instrument automatically.

```ts
import { LogsClient } from "@hasna/logs-sdk"

const logs = new LogsClient({
  projectId: "my-project",
  apiKey: process.env.HASNA_LOGS_API_KEY,
})

await logs.push({ level: "info", message: "worker started" })
await logs.captureException(new Error("boom"), { projectId: "my-project" })
await logs.captureMetric("queue.depth", 42, { projectId: "my-project" })
```

Writing: `push`, `pushBatch`, `pushEvent`, `pushEvents`, `pushStructuredLog`,
`pushStructuredLogs`, `captureException`, `captureMetric`, `captureSpan`.

Reading: `search`, `tail`, `summary`, `context`.

Projects and scanning: `registerProject`, `registerPage`, `createScanJob`,
`perfSnapshot`, `perfTrend`.

## Logger transports

Subpath exports adapt the client to an existing structured logger.

```ts
import pino from "pino"
import createPinoOpenLogsTransport from "@hasna/logs-sdk/pino"

const logger = pino(createPinoOpenLogsTransport({
  projectId: "my-project",
  apiKey: process.env.HASNA_LOGS_API_KEY,
}))
```

```ts
import winston from "winston"
import createWinstonOpenLogsTransport from "@hasna/logs-sdk/winston"

const logger = winston.createLogger({
  transports: [createWinstonOpenLogsTransport({ projectId: "my-project" })],
})
```

Both transports expose `flush()`, `stats()` and `stop()` so a process can drain
buffered records before exit.

## HTTP instrumentation

```ts
import {
  createHonoTelemetryMiddleware,
  createExpressTelemetryMiddleware,
  createExpressErrorTelemetryMiddleware,
  captureNodeHttpRequest,
  captureHttpRequest,
  instrumentFetchHandler,
} from "@hasna/logs-sdk"
```

`createHonoTelemetryMiddleware` and the Express pair wrap a request cycle and
report timing plus any thrown error. `captureNodeHttpRequest` covers a raw
`node:http` server, and `instrumentFetchHandler` wraps a `fetch`-style handler.
Fastify is supported through the exported `FastifyTelemetryHooks` shape.

## Exports

| Entry point | Contents |
| --- | --- |
| `@hasna/logs-sdk` | `LogsClient`, `initUniversalLogs`, HTTP helpers, transports |
| `@hasna/logs-sdk/browser` | Browser build |
| `@hasna/logs-sdk/node` | Node build |
| `@hasna/logs-sdk/pino` | `createPinoOpenLogsTransport` |
| `@hasna/logs-sdk/winston` | `createWinstonOpenLogsTransport` |

TypeScript declarations ship with every entry point.

## License

Apache-2.0
