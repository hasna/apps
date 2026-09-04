# Changelog

## 0.2.11

### Patch Changes

- Copy provider media (call recordings, voicemails, inbound SMS/WhatsApp media) into the configured S3 bucket on the recording/voicemail/inbound-media webhooks (hasna/apps#1649). With `HASNA_TELEPHONY_S3_BUCKET` (alias `TELEPHONY_S3_BUCKET`) set, the webhook path fetches the provider `media_url`, uploads a content-addressed copy at `<prefix>/media/<call_or_message_id>/<sha256>.<ext>` (default prefix `telephony`, `HASNA_TELEPHONY_S3_PREFIX` overrides) and stores `object_key` + `sha256` on the call/voicemail/message row — so playback no longer depends on the provider's retention or account status. No bucket configured → no copy, existing behavior unchanged. Copy failures are logged and soft-failed (the row keeps the provider URL and `object_key` null), so media problems never break webhook handling or row writes. New `object_key`/`sha256` columns via SQLite migration 4 and a Postgres migration; the `/v1` API accepts and returns them.

## 0.2.10

### Patch Changes

- Switch @hasna/telephony local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The telephony data home (SQLite store and audio output) is resolved as `~/.local/share/hasna/telephony` on Linux and `~/Library/Application Support/Hasna/telephony` on macOS, adopted only once the store has actually been migrated there or the operator sets the data-kind override `HASNA_DATA_HOME` — the legacy `~/.hasna/telephony` default stays the effective home until then, so an existing local store never becomes invisible on upgrade. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)
