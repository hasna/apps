// Secrets Vault — service worker.
//
// The single bridge between the popup and the native messaging host. The host
// is spawned only while a request is in flight; each request gets one fresh
// host connection and the response is forwarded verbatim. Nothing is stored
// here, and no credential value ever touches extension storage.
const HOST_NAME = "com.hasna.secrets";

function withHost(request) {
  return new Promise((resolve) => {
    let port;
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (err) {
      resolve({ ok: false, error: `E_HOST: ${String((err && err.message) || err)}` });
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      port.disconnect();
      resolve({ ok: false, error: "E_HOST_TIMEOUT: the native host did not answer" });
    }, 25_000);

    port.onMessage.addListener((response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: "E_HOST_DISCONNECTED: the native host is not installed or crashed" });
    });
    port.postMessage(request);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.verb !== "string") {
    sendResponse({ ok: false, error: "E_BAD_MESSAGE: expected { verb, ... }" });
    return;
  }
  const allowed = new Set(["auth-status", "search", "get", "add-login"]);
  if (!allowed.has(msg.verb)) {
    sendResponse({ ok: false, error: `E_VERB: unknown verb '${msg.verb}'` });
    return;
  }
  withHost(msg).then(sendResponse);
  return true; // async response
});
