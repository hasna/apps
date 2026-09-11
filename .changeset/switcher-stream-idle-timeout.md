---
"@hasna/switcher": patch
---

Replace the four-minute total provider-response deadline with a four-minute inactivity watchdog across all inference bridges (gateway, Grok, Hermes, Gemini). Keepalive bytes and streamed content allow long responses to finish, while idle headers or streams return a distinct sanitized `provider_idle_timeout` (HTTP 504). Preserve caller cancellation, terminal completion and downstream backpressure without replaying partial responses.

Prevent a provider that never acknowledges stream cancellation from blocking local error handling or bridge cleanup.
