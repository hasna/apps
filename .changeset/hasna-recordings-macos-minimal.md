---
"@hasna/recordings": patch
---

Simplify Hasna Recordings to one recordings window, remove native project navigation,
repair Settings in the app and menu bar, and use the spaced app bundle filename.
Add a configurable native API connection with an endpoint-scoped Keychain credential,
and exclude live Swift build caches from the embedded CLI build.
Read the saved OpenAI provider key from Keychain on Finder launches, save new provider
keys securely, and pass them to the helper without confusing service authentication.
