# connect-tidio

Tidio OpenAPI connector package.

## Current API Contract

- Base URL: `https://api.tidio.com/`
- Accept header: `application/json; version=1`
- Auth headers:
  - `X-Tidio-Openapi-Client-Id`
  - `X-Tidio-Openapi-Client-Secret`

Do not reintroduce the legacy `https://api.tidio.co/v1` base URL or a single `X-Tidio-Openapi-Key` header.

## Supported Areas

- Contacts and contact properties
- Contact messages at `/contacts/{contactId}/messages`
- Departments
- Operators
- Project info
- Tickets
- Products for Lyro recommendations
- Lyro data sources and ticket answering helpers

Do not add undocumented CRUD helpers for `/conversations`, `/tags`, `/automations`, `/canned-responses`, or `/webhooks` unless the current Tidio docs prove those OpenAPI paths exist.

## Security

Profiles store client id and client secret under the connector config directory. Keep config directories `0700`, profile files `0600`, and validate profile names before joining filesystem paths.
