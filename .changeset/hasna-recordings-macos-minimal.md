---
"@hasna/recordings": patch
---

Simplify Hasna Recordings to one recordings window, remove native project navigation,
repair Settings in the app and menu bar, and use the spaced app bundle filename.
Add a configurable native API connection with an endpoint-scoped Keychain credential,
and exclude live Swift build caches from the embedded CLI build.
Read the saved OpenAI provider key from Keychain on Finder launches, save new provider
keys securely, and pass them to the helper without confusing service authentication.
Flush complete JSON output before the companion exits so large recording histories,
search results, and long transcripts load without truncated responses.
Parse PostgreSQL timestamps in native recording history, and detect revoked table
owner cleanup privileges before the API reports ready with broken deletion.
Keep realtime transcription responsive with a lightweight recording panel, cached
history searches, and microphone shutdown off the UI thread. Default new native
installations to dictation without an extra question/command classification request.
