# Custom send headers and tags

The MCP `send_email` tool and `/v1/messages/send` accept `headers` and `tags`.
The terminal data-source interface exposes the same fields. Scheduled enqueue
preserves both through the worker's normal authenticated send path.

Custom headers must use `X-*` extension names, at most 78 characters, with no
case-insensitive duplicate names. Up to 20 headers are accepted. Values contain
1–900 printable ASCII characters; the combined header budget is 8,192 bytes.
Newlines and control characters are rejected. Transport, authentication,
provider configuration, service forwarding, and tracking names are reserved,
including `X-SES-*`, `X-Hasna-*`, `X-Emails-*`, and `X-Resend-*`. Use explicit
send fields for recipients, reply-to, unsubscribe and tracking configuration.
The server validates metadata before resolving or calling a provider.

Tags contain at most 50 string pairs. Both names and values contain 1–256 ASCII
letters, digits, underscores, or hyphens. This common restriction works with the
SES and Resend adapters. SES preserves tags on both simple and raw MIME sends,
including messages with attachments or custom headers.

The server saves custom headers in the send intent and tags in `messages.tags`.
Message details expose headers and tags; lists expose tags. Sent-ledger MCP reads
also return recorded tags. Historical rows can report null tags. Headers and tags
participate in the idempotency hash: changing them under the same key conflicts.
Header names are normalized to lowercase, so changing only their case is a retry.
Trusted internal forwarding headers remain separate from caller authority.

Deploy migration `0040_message_send_tags` before running this API version.
Clients check the advertised send/enqueue schema and refuse unsupported older
APIs before posting metadata-bearing messages. Saving tags records send metadata;
it does not claim delivery or any provider event occurred.
