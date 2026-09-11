# Account feedback

The MCP `send_feedback` tool saves feedback in the authenticated Emails tenant through
`POST /v1/feedback`. It requires `emails:write`, accepts a message (1–10,000 characters),
an optional contact email (at most 254 characters), and category `bug`, `feature`, or
`general` (the default). It uses the same saved account credentials as other MCP tools.

A successful receipt contains the saved row ID, `status: "saved"`, and
`delivery: "not_sent"`. This is account storage, not an email, external support ticket,
or promise of a response. No provider or cloud send is performed. A request with an
unknown outcome must be inspected before resubmission; creation is not an idempotent
external delivery operation.

Tenant members with `emails:read` can list or retrieve their account's feedback using
`GET /v1/feedback` and `GET /v1/feedback/{id}`. The tenant's `emails:write` authority can
update or delete it using the corresponding resource routes. Other tenants cannot
access the rows. The caller cannot choose a different tenant or set delivery status.

Deployment requires migration `0039_service_feedback` and the updated API. The table
uses PostgreSQL tenant predicates and forced row-level security. Older APIs report an
upgrade requirement; clients do not fall back to a local database. Feedback content and
contact addresses are tenant data and are not published or sent to another service.
