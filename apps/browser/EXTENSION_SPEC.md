# SPEC: `extension` engine — run automation inside the user's real, logged-in Chrome session

Goal: add a Chrome MV3 extension + an explicit `extension` engine to `@hasna/browser` so authorized
automation can run **inside an operator-paired visible Chrome profile**. This is for real-session
workflows where the operator has already logged in and approved the extension bridge. It is not a way to evade bot detection, bypass site anti-abuse controls, or claim hardware-trusted user input.
Postiz pattern, clean-room (reuse the pattern, not the AGPL code).

> **Correction to the initial goal prompt:** this repo is a **single Bun package**, NOT a monorepo with
> `apps/`. Put the extension in **`extension/`** at the repo root (its own Vite sub-build), not `apps/extension`.

## (a) Layout
```
browser/
├── extension/                    # NEW — MV3 extension (Vite → extension/dist/)
│   ├── manifest.json             # MV3; permissions: scripting, tabs, activeTab, storage, alarms;
│   │                             # host_permissions ["<all_urls>"]; background service_worker (module);
│   │                             # action.default_popup. NO externally_connectable (SW dials OUT).
│   │                             # minimum_chrome_version "116" (WS keepalive in SW).
│   ├── src/{background.ts,executor.ts,protocol.ts,popup/{popup.html,popup.ts}}
│   ├── public/{icon-32.png,icon-128.png}
│   ├── vite.config.ts, tsconfig.json, package.json  # "@hasna/browser-extension", private
├── src/engines/extension.ts      # NEW — Page-compatible proxy (model on bun-webview.ts / tui.ts)
├── src/lib/extension-bridge.ts   # NEW — WS hub: pairing tokens, connected-ext registry, job-id correlation
```
Add `extension/dist/` to package `files`; add `build:extension` to the `build` chain; `browser extension path`
prints `.../dist` for "Load unpacked". Produce a `.zip` for the Web Store later (Postiz pattern).

## (b) Channel — extension SW dials OUT to browser-serve (inverted from Postiz)
- SW opens the loopback extension WebSocket with a pairing token query parameter. The local server is the
  controller; the extension is the worker. Avoids `externally_connectable`.
- **MV3 SW keepalive (critical):** since Chrome 116 an active WebSocket + messages reset the SW idle timer;
  add a ~20s ping + a `chrome.alarms` (min 1 min) safety re-wake + exponential-backoff reconnect. Hence
  `minimum_chrome_version: 116`.
- Auth: per-pairing bearer token validated by `browser-serve` on WS upgrade (token in query param — browsers
  can't set WS headers). Reuse existing `BROWSER_API_KEY`/`authenticate()` + loopback CORS in `src/server/index.ts`;
  Bun `server.upgrade(req)` in the existing fetch handler.
- **Job protocol** (`extension/src/protocol.ts` + mirror in `src/types/index.ts`), request/response correlated by `id`:
  `ExtJob` = navigate | click | type | fill | extract(text|html|links|snapshot) | screenshot | evaluate(gated) | ping;
  `ExtResult` = `{id, ok:true, data?, screenshot?}` | `{id, ok:false, error}`.
- **Execution in active tab** (`background.ts`): resolve tab (`chrome.tabs.query({active,lastFocusedWindow})` or
  explicit tabId); navigate via `chrome.tabs.update` + `tabs.onUpdated` complete; click/type/fill/extract via
  `chrome.scripting.executeScript({target:{tabId}, func, args})` (executor.ts dispatches real DOM events / reads
  text/html/links/snapshot; injected DOM events remain synthetic and `Event.isTrusted` remains false); screenshot via `chrome.tabs.captureVisibleTab` → b64 →
  server Sharp compression (`src/lib/screenshot.ts`/`compress.ts`). Wrap as `ExtResult{id}`, send over WS.
- **Server correlation** (`src/lib/extension-bridge.ts`): `Map<jobId,{resolve,reject,timer}>`; engine calls
  `dispatch(job)` → Promise resolved on matching `ExtResult.id` (timeout→reject). `connectedExtensions` registry keyed by token.

## (c) Engine + routing + pairing
- Add `"extension"` to `BrowserEngine` union (`src/types/index.ts:3`). Add `isExtensionAvailable()` in
  `src/engines/selector.ts` (available iff a paired+connected extension exists). **Explicit-only — never auto-selected**
  (no `ENGINE_MAP` entry; `selectEngine` returns it only when `explicit === "extension"`).
- **Engine adapter** `src/engines/extension.ts`: export `ExtensionPage`, a **Playwright-`Page`-compatible proxy**
  (model on `bun-webview.ts` `createBunProxy` + `tui.ts` non-PW pattern) whose goto/click/fill/type/screenshot/url/
  title/innerText/$$eval-equivalents call `extensionBridge.dispatch(...)`. Plus `getPairedExtensionOrThrow`, `createExtensionPage`.
- **Session wiring** `src/lib/session.ts createSession`: add `resolvedEngine === "extension"` branch → `getPairedExtensionOrThrow()`
  + `createExtensionPage(conn)`; **skip** Playwright listeners and Playwright-only stealth patches, like the `bunView` branch.
  Add `isExtensionSession(id)` symmetric to `isBunSession`.
- **Routing — no per-tool rewrites:** SDK (`src/sdk.ts`) is engine-agnostic — `open({engine:"extension"})` flows through
  `createSession`. CLI: `--engine extension` already threads via commander; add a `browser extension` command group
  (`pair`,`status`,`path`,`unpair`) in `src/cli/index.tsx`. MCP: add `"extension"` to engine enums + tools
  `browser_extension_pair`/`browser_extension_status`. REST: `POST /api/sessions {engine:"extension"}` already plumbs engine;
  add `POST /api/extension/pair`, `GET /api/extension/status`, `POST /api/extension/unpair`, and `GET /extension/ws` upgrade.
- **Pairing flow:** `browser extension pair` → server mints a short-lived single-use 6-digit **code** + a long-lived
  **token**, prints code + "Load unpacked → .../dist". User loads unpacked (first time), clicks toolbar → popup, enters code.
  Popup→SW opens WS `?code=<code>`; server validates, upgrades, returns persistent token; SW saves it in
  `chrome.storage.local`. CLI polls `GET /api/extension/status` until `paired:true`. Reconnects use the saved token.

## (d) Security
- **No server-side credentials** — the user's live Chrome session is the auth. (Optional Postiz-style `chrome.cookies`
  read stays opt-in per provider, never automatic.)
- Loopback-only WS + token-gated upgrade; code single-use/short-lived; token revocable via `browser extension unpair`.
- Operator authorization is required for extension sessions. The extension engine must not be presented as CAPTCHA,
  MFA, rate-limit, bot-detection, paywall, access-control, or terms-of-service bypass.
- Active-tab DOM jobs only: no browser chrome control, no WebAuthn or MFA bypass, no hardware-trusted clicks/keys,
  and no cookie export by default.
- Closed action enum; **`evaluate` (arbitrary JS) disabled by default**, behind an explicit `BROWSER_EXTENSION_ALLOW_EVAL` opt-in
  (mirrors `BROWSER_ENABLE_BUN_WEBVIEW`).
- Host scoping: ship `<all_urls>` but document per-provider narrowing. Full audit: log every job+result via the existing
  event/timeline (`src/db/timeline.ts`, `logEvent`) with origin/tab URL/selector/outcome. No silent auto-pairing (human enters code).

## (e) Tests (`bun test`, colocated `*.test.ts`; never skip)
1. Unit (no Chrome): `src/lib/extension-bridge.test.ts` (job-id correlate/resolve/timeout/reject, code+token mint/expiry/
   single-use/revoke); `src/engines/extension.test.ts` (proxy maps actions→ExtJob, unwraps results; `extension` never auto-picked,
   clear error when unpaired). Mock WS with in-memory duplex.
2. Unit executor (jsdom/happy-dom): `extension/src/executor.test.ts` — injected funcs click right node, set value + fire
   input/change, extract text/links/snapshot.
3. **E2E (gated by `BROWSER_E2E`, a real test):** build `extension/dist`; launch headed Chromium via Playwright with
   `--load-extension=extension/dist --disable-extensions-except=… --user-data-dir=…`; start browser-serve on ephemeral port;
   pair (inject token into `chrome.storage.local` or drive popup); assert WS connects (`status`→paired); then
   `BrowserSDK.open({engine:"extension"})` → navigate to a local fixture → `extract text` → assert text matches AND a
   timeline row shows `engine:"extension"`. This is the load-bearing proof.
Plus `src/cli/index.test.ts`: `browser extension --help` and `--engine extension` parse.

## (f) Build order
1. Types+selector (`extension` in union, `isExtensionAvailable`, explicit-only) — TDD selector tests.
2. `src/lib/extension-bridge.ts` (registry, code/token mint+store via `src/db/`, `dispatch` correlation+timeout, revoke) — TDD.
3. Server: `GET /extension/ws` (Bun `server.upgrade`, validate token/code, register/cleanup, ping/pong),
   `POST /api/extension/pair`, `GET /api/extension/status`, `POST /api/extension/unpair`; screenshots via Sharp.
4. `src/engines/extension.ts` `ExtensionPage` proxy (model bun-webview/tui) + `getPairedExtensionOrThrow`/`createExtensionPage`.
5. `src/lib/session.ts` `extension` branch (skip PW listeners and Playwright-only stealth patches) + `isExtensionSession`/`getSessionPage`.
6. `extension/` app (Vite MV3): manifest, background (WS client + 20s ping + alarms + reconnect + job dispatch via
   scripting/tabs/captureVisibleTab), executor (injected DOM funcs), protocol, popup (code entry + status), icons — TDD executor.
7. CLI `src/cli/commands/extension.ts` (`pair`/`status`/`path`/`unpair`) + register; thread `--engine extension`.
8. MCP: `"extension"` in enums + `browser_extension_pair`/`browser_extension_status`.
9. SDK: no change; add `sdk.test.ts` case opening `{engine:"extension"}` vs mocked bridge.
10. Packaging: `extension/dist/` in `files`; `build:extension` in build chain; token store path under the resolver-resolved browser data home (`@hasna/paths`; the legacy `~/.hasna/browser` default until the XDG data home is adopted).
11. Run full `bun test` green incl. gated e2e.
12. Docs: `ARCHITECTURE.md` engine table + "Extension engine" section; `README.md` `browser extension pair` / `--engine extension` + security.

## Key reference files
- Seam/proxy patterns: `src/lib/session.ts` (engine switch), `src/engines/bun-webview.ts` (proxy), `src/engines/tui.ts` (non-PW engine).
- Engine type/selection: `src/types/index.ts` (line 3), `src/engines/selector.ts`.
- Routing surfaces: `src/sdk.ts`, `src/cli/index.tsx`, `src/mcp/actions.ts`, `src/server/index.ts` (auth + engine plumbing).
- Postiz reference (pattern only, AGPL — clean-room): `/tmp/postiz-analysis/apps/extension/` and `isChromeExtension`/`extensionCookies`
  in `/tmp/postiz-analysis/libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`.
