# @hasna/connectors-sdk

Zero-dependency TypeScript SDK for local `@hasna/connectors` servers and
hosted platform connectors APIs.

## Local connectors-serve

`ConnectorsClient` remains the backwards-compatible local client. It talks to
`connectors-serve` on port `9876` by default.

```ts
import { ConnectorsClient, LocalConnectorsClient } from "@hasna/connectors-sdk";

const local = new ConnectorsClient();
const explicitLocal = new LocalConnectorsClient({
  serverUrl: "http://localhost:9876",
});

await local.list();
await explicitLocal.runStructuredOperation("github", {
  operation: "user.info",
  input: { username: "octocat" },
});
```

## Hosted API

`HostedConnectorsClient` talks to a hosted `/api/v1` platform endpoint. It is
for SaaS consumers that need connector discovery, hosted accounts, OAuth URLs,
runs, approvals, billing, usage, and policy gates without local connector
installs.

```ts
import {
  HostedConnectorsClient,
  HostedConnectorsError,
} from "@hasna/connectors-sdk";

const hosted = new HostedConnectorsClient({
  apiUrl: "https://connectors.example",
  apiKey: process.env.CONNECTORS_API_KEY,
});

const connectors = await hosted.listConnectors({ search: "github" });
const auth = await hosted.getConnectorAuthUrl("github", {
  redirectUrl: "https://app.example/oauth/callback",
  profileName: "default",
  scopes: ["repo", "read:user"],
});

const account = await hosted.connectAccount({
  connectorSlug: "github",
  displayName: "GitHub",
  authType: "oauth2",
  credentials: { access_token: "server-owned-token" },
});

const run = await hosted.submitRun({
  connectorSlug: "github",
  operationName: "repos",
  accountId: account.account.id,
  profileName: "default",
  input: { visibility: "private" },
  idempotencyKey: "repos-sync-001",
});

try {
  await hosted.submitRun({
    connectorSlug: "connect-github",
    operationName: "repos",
  });
} catch (error) {
  if (error instanceof HostedConnectorsError) {
    console.error(error.status, error.code, error.requestId);
  }
}
```

Connector inputs are normalized by the SDK, so `github`, `connect-github`, and
`@hasna/connect-github` all target the canonical `github` slug.

The SDK package does not import `@hasna/connectors`; hosted browser bundles get
only the typed HTTP client code.
