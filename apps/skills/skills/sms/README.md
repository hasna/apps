# SMS

Local MCP SMS skill for AI agents using user-provided Twilio credentials.

## Boundary

The OSS package ships only the stdio MCP implementation. It does not ship an
HTTP server, SSE server, phone-number purchasing scripts, hosted account state,
or billing logic.

## Usage

```bash
skills run sms --help
```

To run the MCP server directly:

```bash
export TWILIO_ACCOUNT_SID="your_account_sid"
export TWILIO_AUTH_TOKEN="your_auth_token"
bun run src/index.ts
```

## Environment Variables

| Variable | Description |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |

Hosted SMS workflows, number purchase approvals, billing, and tenant-level
message history belong in the hosted platform or an external connector.
