# Secrets Vault — Chrome extension

A LastPass-style password manager that stores logins in your **local secrets
vault** (`secrets items`). The vault is the store; the extension is a UI over
it. It **reuses your existing local session** — if the `secrets` CLI already
works in your terminal, the extension works too and never asks you to
authenticate again.

Owner ask (2026-08-19): installable in Google Chrome, detects the website you
are on, and lets you add which website a password is for (per-site labels).

## How it works

```
Chrome popup ──► background service worker ──► native host (host.cjs)
                                                   │  shells your own `secrets` CLI
                                                   ▼
                                        your local vault (items add-login/search/get)
```

- **Auth reuse**: the native host shells the `secrets` CLI that is already on
  your machine, with your own session environment. No token, no second login.
  If the CLI cannot open the vault, the popup says so and points at the
  existing CLI setup path (`secrets status`) — the extension never invents its
  own authentication.
- **Site detection**: the popup shows the active tab's origin. Adding a login
  stores the website as the per-site label (`add-login --url`), and matching
  is by hostname against the vault's own item search.
- **Explicit-action fill only**: clicking **Fill** injects the content script
  into the current tab and fills the username/password fields. Nothing is
  ever filled, or even injected, on page load.
- **Credential-zero bundle**: the extension contains no keys, tokens, or vault
  values. Passwords travel only at runtime, from the CLI through the host to
  the popup to the page you clicked Fill on.
- **Fail-closed protocol**: the host answers bounded JSON messages
  (`auth-status`, `search`, `get`, `add-login`). Malformed messages, unknown
  verbs, a missing CLI, or an unreachable vault produce an explicit error in
  the popup — never silence.

## Install (owner's Chrome)

1. **Install the native host** (one command, no root):

   ```bash
   cd apps/secrets/extension/native-host
   ./install-host.sh
   ```

   This installs three things (all idempotent; re-run after updating the
   extension to refresh):
   - the host manifest at
     `~/.config/google-chrome/NativeMessagingHosts/com.hasna.secrets.json`
     (Linux) or
     `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.hasna.secrets.json`
     (macOS);
   - a **materialized host copy** at
     `~/.hasna/secrets/native-host/host.cjs` whose first line is the absolute
     node binary resolved from your shell. Chrome launches the host with
     launchd's environment, whose PATH is empty — a `#!/usr/bin/env node`
     shebang fails there with `env: node: No such file or directory`
     (measured on station03). The absolute shebang needs no PATH; and
   - `host-config.json` next to it embedding the absolute path of your
     `secrets` CLI, so the host never does a PATH lookup either (it prepends
     the CLI's own directory to the child PATH so the CLI's interpreter, bun,
     resolves).

2. **Load the extension unpacked**:
   - Open Chrome → `chrome://extensions`
   - Enable **Developer mode** (top right)
   - **Load unpacked** → select the `apps/secrets/extension` directory
   - The extension id is pinned by the `key` field:
     `ndiliggbckgnekphfmdmbcmbjfceajfk` (matches the host's allowed_origins)

3. **Verify**: pin the extension, open any login page (e.g. github.com), click
   the extension → it shows the site, searches your vault, and **Fill** puts
   the credentials into the form.

## Requirements

- The `secrets` CLI installed and usable in your terminal (that is the whole
  "already authenticated locally" check).
- A recent Node.js for the host script (`node` on PATH) — or edit
  `host.cjs`'s shebang to point at `bun` if you prefer.

## Development

```bash
cd apps/secrets
bun test extension/test     # host protocol + site parsing + fill tests
```

The host protocol tests run the real host against a throwaway vault store
(`HASNA_SECRETS_DB_PATH` in a temp dir) with the cloud selectors stripped, so
the suite is hermetic and can never touch a real vault.

## Layout

| path | role |
|---|---|
| `manifest.json` | MV3 manifest; pinned key for a stable extension id |
| `background.js` | service worker; the only bridge to the native host |
| `popup.html/.css/.js` | active-tab site detection, search, fill, add-login |
| `site.js` | origin extraction (pure, tested) |
| `fill.js` | form-fill plan logic (pure, tested; no auto-run) |
| `content.js` | injected on Fill click only; forwards the FILL message |
| `native-host/host.cjs` | native messaging host; shells the `secrets` CLI |
| `native-host/com.hasna.secrets.json.example` | host manifest template |
| `native-host/install-host.sh` | per-user host manifest installer |
| `test/` | protocol + site + fill tests (bun test) |
